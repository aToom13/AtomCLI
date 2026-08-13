import type { Argv } from "yargs"
import { Session } from "@/core/session"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Storage } from "@/core/storage/storage"
import { Instance } from "@/services/project/instance"
import { EOL } from "os"

export namespace SessionImport {
  export type ExportData = {
    info: Session.Info
    messages: Array<{
      info: any
      parts: any[]
    }>
  }

  type ShareData =
    | { type: "session"; data: Session.Info }
    | { type: "message"; data: any }
    | { type: "part"; data: any }
    | { type: "session_diff" | "model"; data: unknown }

  export function parseShareUrl(value: string) {
    try {
      const url = new URL(value)
      if (url.protocol !== "http:" && url.protocol !== "https:") return
      if (url.search || url.hash) return
      const match = url.pathname.match(/^\/(?:s|share)\/([a-zA-Z0-9_-]+)\/?$/)
      if (!match) return
      return {
        id: match[1],
        origin: url.origin,
      }
    } catch {
      return
    }
  }

  export function normalize(data: unknown): ExportData | undefined {
    if (Array.isArray(data)) {
      const items = data as ShareData[]
      const session = items.find((item) => item?.type === "session")?.data as Session.Info | undefined
      if (!session) return

      const messages = new Map<string, any>()
      const parts = new Map<string, any[]>()
      for (const item of items) {
        if (item?.type === "message" && item.data?.id) messages.set(item.data.id, item.data)
        if (item?.type === "part" && item.data?.messageID) {
          const values = parts.get(item.data.messageID) ?? []
          values.push(item.data)
          parts.set(item.data.messageID, values)
        }
      }
      if (messages.size === 0) return
      return {
        info: session,
        messages: [...messages.values()].map((info) => ({
          info,
          parts: parts.get(info.id) ?? [],
        })),
      }
    }

    if (!data || typeof data !== "object") return
    const legacy = data as { info?: Session.Info; messages?: unknown }
    if (!legacy.info || !legacy.messages) return
    if (Array.isArray(legacy.messages)) {
      return {
        info: legacy.info,
        messages: legacy.messages as ExportData["messages"],
      }
    }
    if (typeof legacy.messages === "object") {
      return {
        info: legacy.info,
        messages: Object.values(legacy.messages).map((message: any) => {
          const { parts = [], ...info } = message
          return { info, parts }
        }),
      }
    }
  }
}

export const ImportCommand = cmd({
  command: "import <file>",
  describe: "import session data from JSON file or URL",
  builder: (yargs: Argv) => {
    return yargs.positional("file", {
      describe: "path to JSON file or atomcli.ai share URL",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      let exportData: SessionImport.ExportData | undefined

      const isUrl = args.file.startsWith("http://") || args.file.startsWith("https://")

      if (isUrl) {
        const share = SessionImport.parseShareUrl(args.file)
        if (!share) {
          process.stdout.write(`Invalid URL format. Expected: https://atomcli.ai/share/<slug>`)
          process.stdout.write(EOL)
          process.exitCode = 1
          return
        }

        const paths = [`/api/share/${share.id}/data`, `/api/share/${share.id}`]
        let response: Response | undefined
        try {
          for (const apiPath of paths) {
            response = await fetch(`${share.origin}${apiPath}`)
            if (response.ok) break
          }
        } catch (error) {
          process.stdout.write(`Failed to fetch share data: ${error instanceof Error ? error.message : String(error)}`)
          process.stdout.write(EOL)
          process.exitCode = 1
          return
        }

        if (!response?.ok) {
          process.stdout.write(`Failed to fetch share data: ${response?.statusText ?? "No response"}`)
          process.stdout.write(EOL)
          process.exitCode = 1
          return
        }

        const data = await response.json().catch(() => undefined)
        exportData = SessionImport.normalize(data)

        if (!exportData) {
          process.stdout.write(`Share not found or empty: ${share.id}`)
          process.stdout.write(EOL)
          process.exitCode = 1
          return
        }
      } else {
        const file = Bun.file(args.file)
        if (!(await file.exists())) {
          process.stdout.write(`File not found: ${args.file}`)
          process.stdout.write(EOL)
          process.exitCode = 1
          return
        }
        exportData = await file
          .json()
          .then(SessionImport.normalize)
          .catch(() => undefined)
        if (!exportData) {
          process.stdout.write(`Invalid session JSON: ${args.file}`)
          process.stdout.write(EOL)
          process.exitCode = 1
          return
        }
      }

      if (!exportData) {
        process.stdout.write(`Failed to read session data`)
        process.stdout.write(EOL)
        process.exitCode = 1
        return
      }

      const info = {
        ...exportData.info,
        projectID: Instance.project.id,
        directory: Instance.directory,
      }
      await Storage.write(["session", Instance.project.id, info.id], info)

      for (const msg of exportData.messages) {
        await Storage.write(["message", exportData.info.id, msg.info.id], msg.info)

        for (const part of msg.parts) {
          await Storage.write(["part", msg.info.id, part.id], part)
        }
      }

      process.stdout.write(`Imported session: ${info.id}`)
      process.stdout.write(EOL)
    })
  },
})
