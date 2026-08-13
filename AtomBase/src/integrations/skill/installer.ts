import fs from "fs/promises"
import path from "path"
import { ConfigMarkdown } from "@/core/config/markdown"
import { Global } from "@/core/global"

export namespace SkillInstaller {
  const MAX_BYTES = 1024 * 1024
  const TIMEOUT_MS = 15_000

  export function normalizeUrl(input: string) {
    let rawUrl = input.trim()
    if (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) {
      rawUrl = `https://raw.githubusercontent.com/${rawUrl}`
    }

    rawUrl = rawUrl.replace(/^https:\/\/github\.com\//, "https://raw.githubusercontent.com/")
    rawUrl = rawUrl.replace("/blob/", "/").replace("/tree/", "/")

    const url = new URL(rawUrl)
    if (url.protocol !== "https:" || url.hostname !== "raw.githubusercontent.com") {
      throw new Error("Skill URL must point to raw.githubusercontent.com over HTTPS")
    }
    const segments = url.pathname.split("/").filter(Boolean)
    if (segments.length < 2) throw new Error("Skill URL must include a GitHub owner and repository")
    if (segments.length === 2) segments.push("main")
    if (!segments.at(-1)?.toLowerCase().endsWith(".md")) segments.push("SKILL.md")
    url.pathname = `/${segments.join("/")}`
    return url.toString()
  }

  async function readBounded(response: Response) {
    const declaredSize = Number(response.headers?.get?.("content-length") ?? 0)
    if (declaredSize > MAX_BYTES) throw new Error("Skill file exceeds the 1 MiB size limit")

    if (!response.body?.getReader) {
      const content = await response.text()
      if (new TextEncoder().encode(content).byteLength > MAX_BYTES) {
        throw new Error("Skill file exceeds the 1 MiB size limit")
      }
      return content
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let total = 0
    let content = ""
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_BYTES) {
          await reader.cancel()
          throw new Error("Skill file exceeds the 1 MiB size limit")
        }
        content += decoder.decode(value, { stream: true })
      }
      return content + decoder.decode()
    } finally {
      reader.releaseLock()
    }
  }

  async function download(url: string, parentSignal: AbortSignal) {
    const controller = new AbortController()
    const abort = () => controller.abort(parentSignal.reason)
    const timeout = setTimeout(() => controller.abort(new Error("Skill download timed out")), TIMEOUT_MS)
    parentSignal.addEventListener("abort", abort, { once: true })
    if (parentSignal.aborted) abort()

    try {
      const response = await fetch(url, { signal: controller.signal, redirect: "error" })
      if (!response.ok) {
        throw new Error(`Failed to fetch skill: ${response.status} ${response.statusText}. URL: ${url}`)
      }
      return await readBounded(response)
    } finally {
      clearTimeout(timeout)
      parentSignal.removeEventListener("abort", abort)
    }
  }

  export async function install(input: { url: string; name?: string; signal: AbortSignal }) {
    const url = normalizeUrl(input.url)
    const content = await download(url, input.signal)
    const parsed = await ConfigMarkdown.parseString(content)
    if (!parsed?.data.name) throw new Error("Invalid skill file: missing 'name' in frontmatter")

    const rawName = String(input.name || parsed.data.name)
    if (rawName.length > 100 || /[\u0000-\u001f]/.test(rawName)) {
      throw new Error("Invalid skill name: use at most 100 printable characters")
    }
    const name = path.basename(rawName)
    const directory = path.resolve(Global.Path.skills, name)
    const relative = path.relative(Global.Path.skills, directory)
    if (
      name !== rawName ||
      name === "." ||
      name === ".." ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      throw new Error(`Invalid skill name "${rawName}": path traversal detected`)
    }

    await fs.mkdir(Global.Path.skills, { recursive: true })
    const existingDirectory = await fs.lstat(directory).catch(() => undefined)
    if (existingDirectory?.isSymbolicLink()) throw new Error(`Refusing to install through symbolic link: ${directory}`)
    await fs.mkdir(directory, { recursive: true })

    const target = path.join(directory, "SKILL.md")
    const existingTarget = await fs.lstat(target).catch(() => undefined)
    if (existingTarget?.isSymbolicLink()) throw new Error(`Refusing to overwrite symbolic link: ${target}`)
    await fs.writeFile(target, content)

    return {
      name,
      directory,
      target,
      url,
      description: String(parsed.data.description || ""),
    }
  }
}
