import z from "zod"
import path from "path"
import { Config } from "@/core/config/config"
import { Instance } from "@/services/project/instance"
import { NamedError } from "@atomcli/util/error"
import { ConfigMarkdown } from "@/core/config/markdown"
import { Log } from "@/util/util/log"
import { Global } from "@/core/global"
import { Filesystem } from "@/util/util/filesystem"
import { exists, realpath } from "fs/promises"
import { Flag } from "@/interfaces/flag/flag"
import { State } from "@/services/project/state"
import { PermissionNext } from "@/util/permission/next"
import type { MessageV2 } from "@/core/session/message-v2"
import type { ExecutionContract } from "@/core/routing/execution-contract"

export namespace Skill {
  const log = Log.create({ service: "skill" })
  export const Info = z.object({
    name: z.string(),
    description: z.string(),
    location: z.string(),
    trigger_words: z.array(z.string()).optional(),
    alternatives: z.array(z.string()).optional(),
    dependencies: z
      .array(z.object({ name: z.string().min(1), when: z.array(z.string().min(1)).optional() }))
      .max(16)
      .optional(),
  })
  export type Info = z.infer<typeof Info>

  export const LoadedChunk = z.object({
    name: z.string(),
    location: z.string(),
    offset: z.number().int().nonnegative(),
    length: z.number().int().nonnegative(),
    totalChars: z.number().int().nonnegative(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    selectedReferences: z.array(z.string()).max(100).optional(),
    selectionReason: z.string().min(1).max(2_000).optional(),
  })
  export type LoadedChunk = z.infer<typeof LoadedChunk>

  export function loadedChunk(
    name: string,
    location: string,
    content: string,
    offset: number,
    length: number,
  ): LoadedChunk {
    return {
      name,
      location: path.resolve(location),
      offset,
      length,
      totalChars: content.length,
      contentHash: new Bun.CryptoHasher("sha256").update(content).digest("hex"),
    }
  }

  export function loadedChunks(messages: MessageV2.WithParts[]) {
    const records = new Map<string, LoadedChunk>()
    const add = (value: unknown) => {
      const parsed = LoadedChunk.safeParse(value)
      if (parsed.success) records.set(JSON.stringify(parsed.data), parsed.data)
    }
    for (const message of messages)
      for (const part of message.parts) {
        if (part.type === "text" && Array.isArray(part.metadata?.skillReads))
          for (const record of part.metadata.skillReads) add(record)
        if (
          part.type !== "tool" ||
          part.tool !== "skill" ||
          part.state.status !== "completed" ||
          part.state.metadata.truncated
        )
          continue
        const info = part.state.metadata
        add({ ...info, name: info.reference ?? info.name })
        if (Array.isArray(info.loadedReferences)) for (const record of info.loadedReferences) add(record)
      }
    return [...records.values()]
  }

  export const InvalidError = NamedError.create(
    "SkillInvalidError",
    z.object({
      path: z.string(),
      message: z.string().optional(),
      issues: z.custom<z.core.$ZodIssue[]>().optional(),
    }),
  )

  export const NameMismatchError = NamedError.create(
    "SkillNameMismatchError",
    z.object({
      path: z.string(),
      expected: z.string(),
      actual: z.string(),
    }),
  )

  const ATOMCLI_SKILL_GLOB = new Bun.Glob("{skill,skills}/**/SKILL.md")
  const CLAUDE_SKILL_GLOB = new Bun.Glob("skills/**/SKILL.md")

  export const state = Instance.state(async () => {
    const skills: Record<string, Info> = {}
    const seenPaths = new Set<string>()

    const addSkill = async (match: string) => {
      if (seenPaths.has(match)) return
      seenPaths.add(match)
      const md = await ConfigMarkdown.parse(match)
      if (!md) {
        return
      }

      const parsed = Info.pick({ name: true, description: true, trigger_words: true, dependencies: true }).safeParse(
        md.data,
      )
      if (!parsed.success) return

      // Warn on duplicate skill names
      if (skills[parsed.data.name]) {
        ;(skills[parsed.data.name].alternatives ??= []).push(match)
        log.warn("duplicate skill name", {
          name: parsed.data.name,
          existing: skills[parsed.data.name].location,
          duplicate: match,
        })
        return
      }

      skills[parsed.data.name] = {
        name: parsed.data.name,
        description: parsed.data.description,
        location: match,
        trigger_words: parsed.data.trigger_words,
        dependencies: parsed.data.dependencies,
      }
    }

    // Scan .atomcli/skills/ and .claude/skills/ directories (project-level)
    // .atomcli is primary, .claude is fallback for backward compatibility
    const skillDirs = await Array.fromAsync(
      Filesystem.up({
        targets: [".atomcli", ".claude"],
        start: Instance.directory,
        stop: Instance.worktree,
      }),
    )
    const projectSkillDirs = skillDirs.length
    // Also include global ~/.atomcli/skills/ and ~/.claude/skills/ (fallback)
    const globalAtom = Global.Path.skills // ~/.atomcli/skills/
    const globalClaude = path.join(Global.Path.home, ".claude")
    if (await exists(globalAtom)) {
      skillDirs.push(path.dirname(globalAtom)) // Add ~/.atomcli/ to scan for skills subdir
    }
    if (await exists(globalClaude)) {
      skillDirs.push(globalClaude)
    }

    // Add bundled skills from installation directory
    if (Flag.ATOMCLI_INSTALL_DIR) {
      const installAtom = path.join(Flag.ATOMCLI_INSTALL_DIR, ".atomcli")
      if (await exists(installAtom)) skillDirs.push(installAtom)

      const installClaude = path.join(Flag.ATOMCLI_INSTALL_DIR, ".claude")
      if (await exists(installClaude)) skillDirs.push(installClaude)
    } else {
      // Fallback for compiled binary: check relative to executable
      try {
        // Binary is likely in bin/atomcli, so look in root of distro (../)
        const binaryDir = path.dirname(process.execPath)
        const distRoot = path.resolve(binaryDir, "..")

        const bundledAtom = path.join(distRoot, ".atomcli")
        if (await exists(bundledAtom)) skillDirs.push(bundledAtom)

        const bundledClaude = path.join(distRoot, ".claude")
        if (await exists(bundledClaude)) skillDirs.push(bundledClaude)
      } catch (e) {
        // ignore
      }
    }

    if (!Flag.ATOMCLI_DISABLE_CLAUDE_CODE_SKILLS) {
      for (const dir of skillDirs.slice(0, projectSkillDirs)) {
        const matches = await Array.fromAsync(
          CLAUDE_SKILL_GLOB.scan({
            cwd: dir,
            absolute: true,
            onlyFiles: true,
            followSymlinks: true,
            dot: true,
          }),
        ).catch((error) => {
          log.error("failed directory scan for skills", { dir, error })
          return []
        })

        for (const match of matches) {
          await addSkill(match)
        }
      }
    }

    // Check project singular directories before global config directories.
    const projectAtomDirs = skillDirs.slice(0, projectSkillDirs).filter((dir) => path.basename(dir) === ".atomcli")
    const sourceAtom = path.resolve(import.meta.dir, "../../../../.atomcli")
    const configDirs = (await Config.state()).directories.filter((dir) => !projectAtomDirs.includes(dir))
    const sourceDirs = (await exists(path.join(sourceAtom, "skills"))) ? [sourceAtom] : []
    for (const dir of [...projectAtomDirs, ...sourceDirs, ...configDirs.filter((dir) => !sourceDirs.includes(dir))]) {
      for await (const match of ATOMCLI_SKILL_GLOB.scan({
        cwd: dir,
        absolute: true,
        onlyFiles: true,
        followSymlinks: true,
      })) {
        await addSkill(match)
      }
    }

    if (!Flag.ATOMCLI_DISABLE_CLAUDE_CODE_SKILLS) {
      for (const dir of skillDirs.slice(projectSkillDirs)) {
        for await (const match of CLAUDE_SKILL_GLOB.scan({
          cwd: dir,
          absolute: true,
          onlyFiles: true,
          followSymlinks: true,
          dot: true,
        })) {
          await addSkill(match)
        }
      }
    }

    return skills
  })

  export async function get(name: string) {
    const skills = await state()
    if (skills[name]) return skills[name]
    const matches = Object.values(skills).filter((skill) => aliases(skill).includes(normalizeName(name)))
    if (matches.length > 1) throw new Error(`Ambiguous skill ${name}: ${matches.map((skill) => skill.name).join(", ")}`)
    return matches[0]
  }

  export async function resolveDependencies(skills: Info[], prompt: string) {
    const resolved: Info[] = []
    const visiting = new Set<string>()
    const visit = async (skill: Info) => {
      if (resolved.some((item) => item.name === skill.name)) return
      if (visiting.has(skill.name)) throw new Error(`Cyclic skill dependency: ${skill.name}`)
      if (visiting.size + resolved.length >= 32) throw new Error("Skill dependency limit exceeded")
      visiting.add(skill.name)
      for (const dependency of skill.dependencies ?? []) {
        if (
          dependency.when?.length &&
          !dependency.when.some((term) => prompt.toLowerCase().includes(term.toLowerCase()))
        )
          continue
        const required = await get(dependency.name)
        if (!required) throw new Error(`Missing skill dependency: ${skill.name} requires ${dependency.name}`)
        await visit(required)
      }
      visiting.delete(skill.name)
      resolved.push(skill)
    }
    for (const skill of skills) await visit(skill)
    return resolved
  }

  export async function taskSkills(contract?: ExecutionContract.Info): Promise<Info[]> {
    if (!contract?.needsMutation || !contract.acceptance?.some((criterion) => criterion.startsWith("3D:"))) return []
    const game = await get("game-development")
    return game ? [game] : []
  }

  export function readOffset(current: LoadedChunk, reads: LoadedChunk[]) {
    const ranges = reads
      .filter(
        (read) =>
          read.location === current.location &&
          read.contentHash === current.contentHash &&
          read.totalChars === current.totalChars &&
          read.offset + read.length <= current.totalChars,
      )
      .sort((a, b) => a.offset - b.offset)
    let offset = 0
    for (const read of ranges) {
      if (read.offset > offset) break
      offset = Math.max(offset, read.offset + read.length)
    }
    return offset
  }

  export async function all() {
    return state().then((x) => Object.values(x))
  }

  /**
   * Scans user text for matching skill trigger_words.
   */
  export async function findAutoInjectCandidates(userPrompt: string): Promise<Info[]> {
    const skills = await all()
    const explicitReferenceRequest = requestsReferences(userPrompt)

    return skills
      .map((skill) => {
        const skillName = skill.name.replace(/[-_]+/g, " ").trim()
        const namePrefix = skillName.split(/\s+/)[0]
        const namedMatch =
          skillName.length > 2 &&
          new RegExp(
            `(?<![\\p{L}\\p{N}])${skillName.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&").replace(/\\s+/g, "\\\\s+")}(?![\\p{L}\\p{N}])`,
            "iu",
          ).test(userPrompt)
        const explicitNamePrefixMatch =
          explicitReferenceRequest &&
          namePrefix.length > 3 &&
          new RegExp(`(?<![\\p{L}\\p{N}])${namePrefix}(?![\\p{L}\\p{N}])`, "iu").test(userPrompt)
        const score = Math.max(
          namedMatch ? skillName.length + 100 : 0,
          explicitNamePrefixMatch ? namePrefix.length + 50 : 0,
          0,
          ...(skill.trigger_words ?? []).map((word) => {
            const phrase = word
              .trim()
              .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
              .replace(/\s+/g, "\\s+")
            return phrase && new RegExp(`(?<![\\p{L}\\p{N}])${phrase}(?![\\p{L}\\p{N}])`, "iu").test(userPrompt)
              ? word.trim().length
              : 0
          }),
        )
        return { skill, score }
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.skill)
  }

  /**
   * Explicit child-reference requests need deterministic loading. Keep this
   * narrow: ordinary skill matches remain advisory and do not add reference
   * content to every turn.
   */
  export function requestsReferences(userPrompt: string) {
    // Explicit paths are resolved separately. Selection advice and "reading list"
    // must not turn every catalog entry into a mandatory read.
    return /(?<!not )(?<!don't )\b(?:read|load|consult)\s+(?:(?:all|every)\s+(?:skill\s+)?references?\b|(?:the\s+)?(?:(?:whole|entire)\s+)?skill\s+tree\b)|(?:alt\s*(?:skill|başlık|başlik|referans)|skill\s*(?:ağac|agac))[\p{L}]*\s+(?:oku|yükle|yukle)\b|(?:tüm|tum|bütün|butun)\s+referans(?:ları|lari)?\s+(?:oku|yükle|yukle)\b/iu.test(
      userPrompt,
    )
  }

  function normalizeName(name: string) {
    return name
      .toLocaleLowerCase()
      .replace(/[-_\s]+/g, " ")
      .trim()
  }

  function aliases(skill: Info) {
    return [...new Set([normalizeName(skill.name), normalizeName(path.basename(path.dirname(skill.location)))])]
  }

  export async function explicitRequests(userPrompt: string) {
    const skills = await all()
    const named: Info[] = []
    const references = new Map<string, string[]>()
    const unresolved: string[] = []
    for (const alias of new Set(skills.flatMap(aliases))) {
      const pattern = alias
        .split(" ")
        .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[-_\\s]+")
      if (!new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "iu").test(userPrompt)) continue
      const matches = skills.filter((skill) => aliases(skill).includes(alias))
      const exact = matches.find((skill) => normalizeName(skill.name) === alias)
      if (matches.length > 1 && !exact) {
        unresolved.push(`${alias}: ambiguous; use ${matches.map((skill) => skill.name).join(", ")}`)
        continue
      }
      const skill = exact ?? matches[0]
      if (!named.includes(skill)) named.push(skill)
    }
    const paths = [
      ...new Set(
        (userPrompt.match(/(?:[\p{L}\p{N}_-]+\/)?references\/[\p{L}\p{N}_./-]+/gu) ?? []).map((name) =>
          name.replace(/\.+$/, ""),
        ),
      ),
    ]
    for (const requested of paths) {
      const [prefix, ...rest] = requested.split("/")
      const relative = prefix === "references" ? requested : rest.join("/")
      const candidates =
        prefix === "references"
          ? named.length
            ? named
            : skills
          : skills.filter((skill) => aliases(skill).includes(normalizeName(prefix)))
      const matches: Info[] = []
      for (const skill of candidates) {
        const catalog = await referenceCatalog(skill)
        if (catalog.some((file) => file.relative === relative || file.relative === `${relative}.md`))
          matches.push(skill)
      }
      if (matches.length !== 1) {
        unresolved.push(
          `${requested}: ${matches.length ? `ambiguous; use ${matches.map((skill) => `${skill.name}/${relative}`).join(", ")}` : "not found"}`,
        )
        continue
      }
      const skill = matches[0]
      if (!named.includes(skill)) named.push(skill)
      references.set(skill.name, [...(references.get(skill.name) ?? []), relative])
    }
    return { skills: named, references, unresolved }
  }

  export async function referenceLocation(skill: Info, relative: string) {
    const root = await realpath(path.dirname(skill.location))
    const location = await realpath(path.resolve(root, relative))
    if (!location.startsWith(root + path.sep))
      throw new Error(`Skill reference path escapes skill directory: ${relative}`)
    return location
  }

  export async function referenceCatalog(skill: Info) {
    const root = path.dirname(skill.location)
    const parsed = await ConfigMarkdown.parse(skill.location)
    const routes = new Map<string, string>()
    for (const line of parsed.content.split("\n")) {
      for (const match of line.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
        const relative = match[2].split("#")[0].replace(/^\.\//, "")
        if (!relative.endsWith(".md") || relative.includes(":") || path.isAbsolute(relative)) continue
        routes.set(relative, line)
      }
    }
    const files = await Array.fromAsync(new Bun.Glob("references/**/*.md").scan({ cwd: root, onlyFiles: true }))
    return [...new Set([...routes.keys(), ...files.sort()])]
      .filter((relative) => {
        const location = path.resolve(root, relative)
        return location.startsWith(path.resolve(root) + path.sep)
      })
      .map((relative) => ({ relative, route: routes.get(relative) ?? relative }))
  }

  export function chunk(content: string, offset = 0, limit = 12_000, maxLines = 500) {
    if (!Number.isInteger(offset) || offset < 0 || offset > content.length)
      throw new Error("Skill offset is outside content")
    if (!Number.isInteger(limit) || limit < 0) throw new Error("Skill limit must be a nonnegative integer")
    const text = content.slice(offset, offset + limit)
    const lines = text.split("\n")
    return lines.length > maxLines ? lines.slice(0, maxLines).join("\n") + "\n" : text
  }

  export function loadingManifest(context: string) {
    return context
      .split("\n")
      .filter((line) =>
        /^(?:Skill: .*; source: |Loaded parent .*: characters |### .*\(characters |Unresolved explicit reference: |Reference request has no unique|- .*offset=)/.test(
          line,
        ),
      )
      .join("\n")
  }

  export async function loadReferences(input: {
    skill: Info
    maxChars?: number
    maxLines?: number
    prompt?: string
    names?: string[]
    relevantOnly?: boolean
    permission?: PermissionNext.Ruleset
    alreadyRead?: LoadedChunk[]
  }) {
    const maxChars = input.maxChars ?? 12_000
    const maxLines = input.maxLines ?? 500
    const ignored = new Set([
      "references",
      "reference",
      "skill",
      "read",
      "load",
      "use",
      "only",
      "please",
      "the",
      "for",
      "and",
      "with",
      "bir",
      "ile",
      "oku",
      "referans",
    ])
    const terms = [
      ...new Set((input.prompt ?? "").toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}|\b3d\b/gu) ?? []),
    ].filter((term) => !ignored.has(term))
    const files = (await referenceCatalog(input.skill))
      .map((file, index) => ({
        ...file,
        index,
        score: terms.filter((term) => file.route.toLocaleLowerCase().includes(term)).length,
      }))
      .filter((file) =>
        input.names !== undefined
          ? input.names.some((name) => file.relative === name || file.relative === `${name}.md`)
          : !input.relevantOnly || file.score > 0,
      )
      .sort((left, right) => right.score - left.score || left.index - right.index)
    const entries: string[] = []
    const sections = new Map<string, string>()
    const loaded: LoadedChunk[] = []
    const remaining: { name: string; offset: number; reason: string }[] = []
    let used = 0
    let usedLines = 0
    for (const file of files) {
      const name = `${input.skill.name}/${file.relative}`
      if (input.permission && PermissionNext.evaluate("skill", name, input.permission).action !== "allow") {
        remaining.push({ name, offset: 0, reason: "permission required; use the skill tool" })
        continue
      }
      try {
        const location = await referenceLocation(input.skill, file.relative)
        const content = (await ConfigMarkdown.parse(location)).content.trim()
        const offset = readOffset(loadedChunk(name, location, content, 0, 0), input.alreadyRead ?? [])
        if (offset === content.length) {
          entries.push(`### ${name}: already loaded from current source; reuse the earlier instructions.`)
          continue
        }
        if (used >= maxChars || usedLines >= maxLines) {
          remaining.push({ name, offset, reason: "context limit" })
          continue
        }
        const chunkText = chunk(content, offset, maxChars - used, maxLines - usedLines)
        const length = chunkText.length
        const record = loadedChunk(name, location, content, offset, length)
        let displayed = chunkText
        // ponytail: dedupe complete unfenced references only; parse Markdown before supporting fenced/partial chunks.
        if (offset === 0 && length === content.length && !/^ {0,3}(?:`{3,}|~{3,})/m.test(content)) {
          displayed = chunkText
            .split(/(?=^## )/m)
            .map((section) => {
              if (!section.startsWith("## ")) return section
              const prior = sections.get(section)
              if (prior) {
                const shared = `${section.split("\n", 1)[0]}\nSame section text as ${prior}.\n\n`
                return shared.length < section.length ? shared : section
              }
              sections.set(section, name)
              return section
            })
            .join("")
        }
        entries.push(
          `### ${name} (characters ${offset}–${offset + length} of ${content.length}; source: ${location})\n${displayed}`,
        )
        loaded.push(record)
        used += length
        usedLines += chunkText.split("\n").length
        if (offset + length < content.length)
          remaining.push({ name, offset: offset + length, reason: "partial; context limit" })
      } catch (error) {
        remaining.push({ name, offset: 0, reason: error instanceof Error ? error.message : String(error) })
      }
    }
    return { entries, loaded, remaining }
  }

  export async function pendingRequiredReads(
    prompt: string,
    messages: MessageV2.WithParts[],
    sinceID?: string,
    routedSkills: Info[] = [],
  ) {
    const explicit = await explicitRequests(prompt)
    const pending = explicit.unresolved.map((item) => `unresolved skill reference: ${item}`)
    const required = new Map<string, { skill: Info; relative?: string }>()
    for (const skill of [...explicit.skills, ...routedSkills]) {
      required.set(skill.name, { skill })
      if (!explicit.references.has(skill.name) && !requestsReferences(prompt)) continue
      const routed = await loadReferences({
        skill,
        prompt,
        names: explicit.references.get(skill.name),
        maxChars: 0,
        relevantOnly: !requestsReferences(prompt),
      })
      for (const file of routed.remaining)
        required.set(file.name, { skill, relative: file.name.slice(skill.name.length + 1) })
    }
    const reads = loadedChunks(messages)
    for (const read of reads) {
      const skill = await get(read.name)
      if (skill && read.name === skill.name) required.set(skill.name, { skill })
    }
    for (const message of messages)
      for (const part of message.parts) {
        if (part.type !== "tool" || part.tool !== "skill" || part.state.status !== "completed") continue
        const info = part.state.metadata
        if ((!sinceID || message.info.id >= sinceID) && typeof info.name === "string" && info.reference === info.name) {
          const skill = await get(info.name)
          if (skill) {
            required.set(skill.name, { skill })
          }
        }
      }
    for (const skill of await resolveDependencies(
      [...required.values()].map((file) => file.skill),
      prompt,
    ))
      required.set(skill.name, { skill })
    for (const { skill } of [...required.values()].filter((file) => !file.relative)) {
      if (explicit.references.has(skill.name) || requestsReferences(prompt)) continue
      const catalog = await referenceCatalog(skill)
      if (!catalog.length) continue
      const content = (await ConfigMarkdown.parse(skill.location)).content.trim()
      const current = loadedChunk(skill.name, skill.location, content, 0, 0)
      const selection = reads.findLast(
        (read) =>
          read.name === skill.name &&
          read.contentHash === current.contentHash &&
          read.selectedReferences !== undefined &&
          !!read.selectionReason,
      )
      if (!selection) {
        pending.push(
          `${skill.name}: select relevant references from the parent instructions with the skill tool's references and reason before editing or completing`,
        )
        continue
      }
      for (const relative of selection.selectedReferences!) {
        if (!catalog.some((file) => file.relative === relative)) {
          pending.push(`${skill.name}/${relative}: selected reference is no longer in the catalog`)
          continue
        }
        required.set(`${skill.name}/${relative}`, { skill, relative })
      }
    }
    for (const [name, file] of required) {
      try {
        const location = file.relative ? await referenceLocation(file.skill, file.relative) : file.skill.location
        const content = (await ConfigMarkdown.parse(location)).content.trim()
        const current = loadedChunk(name, location, content, 0, 0)
        const ranges = reads
          .filter(
            (read) =>
              read.location === current.location &&
              read.contentHash === current.contentHash &&
              read.totalChars === content.length &&
              read.offset + read.length <= content.length,
          )
          .sort((a, b) => a.offset - b.offset)
        let offset = 0
        for (const read of ranges) {
          if (read.offset > offset) break
          offset = Math.max(offset, read.offset + read.length)
        }
        if (offset < content.length || !ranges.length)
          pending.push(`${name}, offset=${offset}: required instructions are not fully read from ${location}`)
      } catch (error) {
        pending.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return pending
  }

  export async function reload() {
    State.invalidate(Instance.directory)
    return state()
  }

  export async function pendingSessionReads(
    sessionID: string,
    execution: { executionID: string; rootSessionID: string },
    fallbackUserID?: string,
  ) {
    const { Session } = await import("@/core/session")
    const { ExecutionRuntime } = await import("@/core/execution/runtime")
    const messages = await Session.messages({ sessionID, excludePatches: true })
    const objective =
      execution.rootSessionID === sessionID ? ExecutionRuntime.objective(execution.executionID) : undefined
    const sinceID =
      objective?.message_id ??
      fallbackUserID ??
      messages.findLast(
        (message) =>
          message.info.role === "user" && message.parts.some((part) => part.type === "text" && !part.synthetic),
      )?.info.id
    const request = [
      objective?.objective ?? "",
      ...messages
        .filter((message) => message.info.role === "user" && (!sinceID || message.info.id >= sinceID))
        .flatMap((message) =>
          message.parts
            .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.synthetic && !part.ignored)
            .map((part) => part.text),
        ),
    ].join("\n")
    return pendingRequiredReads(
      request,
      messages,
      sinceID,
      execution.rootSessionID === sessionID
        ? await taskSkills(ExecutionRuntime.getExecutionContract(execution.executionID))
        : [],
    )
  }
}
