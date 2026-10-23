import path from "path"
import z from "zod"
import { Tool } from "./tool"
import { Skill } from "../skill"
import { ConfigMarkdown } from "@/core/config/markdown"
import { PermissionNext } from "@/util/permission/next"
import { SkillInstaller } from "../skill/installer"
import { existsSync } from "fs"
import { MessageV2 } from "@/core/session/message-v2"

const parameters = z.object({
  action: z
    .enum(["load", "add"])
    .default("load")
    .describe("Action to perform: 'load' an available skill, or 'add' a new skill from a GitHub URL"),
  name: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "The skill identifier from available_skills to load (for action='load') OR custom skill name (for action='add')",
    ),
  url: z
    .string()
    .max(8192)
    .optional()
    .describe("GitHub URL to the skill file or directory (required for action='add')"),
  offset: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe("Character offset for the next chunk of a skill or reference"),
  limit: z.number().int().min(1).max(48_000).default(24_000).describe("Maximum characters per loaded file chunk"),
  task: z.string().max(20_000).optional().describe("Task context for dependencies and selected references"),
  references: z
    .array(z.string().min(1).max(1_000))
    .max(100)
    .optional()
    .describe(
      "Complete selection of relative reference paths required by the parent instructions for this task. Include shared foundations and verification. An empty selection needs a reason.",
    ),
  reason: z
    .string()
    .min(1)
    .max(2_000)
    .optional()
    .describe("Why this reference selection covers the task according to the parent instructions"),
})

type Metadata = {
  name: string
  dir: string
  url: string
  description: string
  location?: string
  reference?: string
  offset?: number
  length?: number
  totalChars?: number
  contentHash?: string
  selectedReferences?: string[]
  selectionReason?: string
  loadedReferences?: Skill.LoadedChunk[]
  remainingReferences?: { name: string; offset: number; reason: string }[]
}

const TOOL_REFERENCE_MAX_CHARS = 40_000
const TOOL_REFERENCE_MAX_LINES = 1_800
const EXPLICIT_REFERENCE_MAX_CHARS = 12_000
const EXPLICIT_REFERENCE_MAX_LINES = 500

function relativeReference(skillName: string, value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "")
  return normalized.startsWith(`${skillName}/`) ? normalized.slice(skillName.length + 1) : normalized
}

export const SkillTool = Tool.define<typeof parameters, Metadata>("skill", async (ctx) => {
  const skills = await Skill.all()

  // Filter skills by agent permissions if agent provided
  const agent = ctx?.agent
  const accessibleSkills = agent
    ? skills.filter((skill) => {
        const rule = PermissionNext.evaluate("skill", skill.name, agent.permission)
        return rule.action !== "deny"
      })
    : skills

  const description =
    accessibleSkills.length === 0
      ? "Load or add a skill. Use action='load' to load a skill, or action='add' to install from GitHub."
      : [
          "Load or add specialized skills for specific tasks.",
          "Use action='load' with name to get detailed instructions.",
          "Load a reference with name='skill-name/references/file.md'. A references/file.md path also works when it matches one available skill.",
          "Use action='add' with url to install a new skill from a GitHub repository.",
          "<available_skills>",
          ...accessibleSkills.flatMap((skill) => [
            `  <skill>`,
            `    <name>${skill.name}</name>`,
            `    <description>${skill.description}</description>`,
            `    <location>${skill.location}</location>`,
            `  </skill>`,
          ]),
          "</available_skills>",
        ].join(" ")

  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      if (params.action === "add") {
        if (!params.url) {
          throw new Error("Parameter 'url' is required for action='add'")
        }

        await ctx.ask({
          permission: "skilladd",
          patterns: [params.url],
          always: [params.url],
          metadata: { url: params.url },
        })

        const installed = await SkillInstaller.install({ url: params.url, name: params.name, signal: ctx.abort })

        await Skill.reload()

        return {
          title: `Installed skill: ${installed.name}`,
          output: [
            `✓ Skill "${installed.name}" installed successfully!`,
            ``,
            `Location: ${installed.target}`,
            `Description: ${installed.description || "No description"}`,
            ``,
            `The skill is now available. Use \`skill\` tool with action="load", name="${installed.name}" to activate it.`,
          ].join("\n"),
          metadata: {
            name: installed.name,
            dir: installed.directory,
            url: params.url,
            description: installed.description,
          },
        }
      }

      // action === "load"
      if (!params.name) {
        throw new Error("Parameter 'name' is required for action='load'")
      }

      let name = params.name
      if (name.startsWith("references/")) {
        const matches = accessibleSkills.filter((item) => {
          const dir = path.dirname(item.location)
          const file = path.resolve(dir, name)
          return file.startsWith(dir + path.sep) && (existsSync(file) || existsSync(`${file}.md`))
        })
        if (matches.length > 1)
          throw new Error(
            `Ambiguous skill reference ${name}. Use one of: ${matches.map((item) => `${item.name}/${name}`).join(", ")}`,
          )
        if (matches.length === 1) name = `${matches[0].name}/${name}`
      }

      const [rootName, ...subpath] = name.split("/")
      const skill = await Skill.get(rootName)

      if (!skill) {
        const available = await Skill.all().then((x) => x.map((s) => s.name).join(", "))
        throw new Error(`Skill "${params.name}" not found. Available skills: ${available || "none"}`)
      }
      name = [skill.name, ...subpath].join("/")

      await ctx.ask({
        permission: "skill",
        patterns: [...new Set([skill.name, name])],
        always: [name],
        metadata: {},
      })
      const dir = path.dirname(skill.location)
      const requested = subpath.length > 0 ? path.resolve(dir, ...subpath) : skill.location
      if (subpath.length > 0 && !requested.startsWith(dir + path.sep))
        throw new Error(`Skill reference path escapes skill directory: ${name}`)
      const location =
        subpath.length === 0
          ? requested
          : existsSync(requested)
            ? requested
            : existsSync(`${requested}.md`)
              ? `${requested}.md`
              : path.join(requested, "SKILL.md")
      const safeLocation = subpath.length
        ? await Skill.referenceLocation(skill, path.relative(dir, location))
        : location
      const parsed = await ConfigMarkdown.parse(safeLocation)
      if (!parsed) throw new Error(`Skill reference not found: ${name}`)
      const content = parsed.content.trim()
      let loadedText = Skill.chunk(content, params.offset, params.limit, TOOL_REFERENCE_MAX_LINES)
      const nextOffset = params.offset + loadedText.length
      const references = subpath.length === 0 ? await Skill.referenceCatalog(skill) : []
      if ((subpath.length || params.offset !== 0) && params.references?.length === 0) params.references = undefined
      const selectedReferences = params.references?.map((reference) => relativeReference(skill.name, reference))
      if (params.references !== undefined) {
        if (subpath.length || params.offset !== 0) throw new Error("Select references on the parent skill at offset=0")
        if (!params.reason?.trim())
          throw new Error("Reference selection requires a reason based on the parent instructions")
        for (const relative of selectedReferences ?? [])
          if (!references.some((file) => file.relative === relative))
            throw new Error(`Unknown skill reference: ${relative}`)
      }
      const task = params.task ?? ctx.extra?.userPrompt ?? ""
      const dependencies = (await Skill.resolveDependencies([skill], task)).filter((item) => item.name !== skill.name)
      const contextMessages = ctx.sessionID.startsWith("ses_")
        ? await MessageV2.filterCompacted(MessageV2.stream({ sessionID: ctx.sessionID, excludePatches: true }))
        : []
      const alreadyRead = Skill.loadedChunks(
        contextMessages
          .filter((message) => message.info.role !== "assistant" || !message.info.summary)
          .map((message) => ({
            ...message,
            parts: message.parts.filter(
              (part) => part.type !== "tool" || part.state.status !== "completed" || !part.state.time.compacted,
            ),
          })),
      )
      const readOffset = Skill.readOffset(Skill.loadedChunk(name, safeLocation, content, 0, 0), alreadyRead)
      const reusedChunk = loadedText.length > 0 && readOffset >= nextOffset
      if (reusedChunk) loadedText = ""
      const remainingOffset = reusedChunk ? readOffset : nextOffset
      const explicit = await Skill.explicitRequests(task)
      const routed =
        subpath.length === 0 &&
        params.offset === 0 &&
        (params.references !== undefined || explicit.references.has(skill.name) || references.length > 0)
          ? await Skill.loadReferences({
              skill,
              prompt: task,
              names: selectedReferences ?? explicit.references.get(skill.name),
              maxChars: params.references === undefined ? TOOL_REFERENCE_MAX_CHARS : EXPLICIT_REFERENCE_MAX_CHARS,
              maxLines: params.references === undefined ? TOOL_REFERENCE_MAX_LINES : EXPLICIT_REFERENCE_MAX_LINES,
              relevantOnly: params.references === undefined && !Skill.requestsReferences(task),
              permission: agent?.permission,
              alreadyRead,
            })
          : { entries: [], loaded: [], remaining: [] }
      const automaticSelection =
        subpath.length === 0 && params.references === undefined
          ? routed.loaded
              .filter((record) => record.offset + record.length === record.totalChars)
              .map((record) => record.name.slice(skill.name.length + 1))
          : undefined
      const automaticSelectionNotice =
        automaticSelection !== undefined
          ? automaticSelection.length > 0
            ? `Automatic selection complete in this call: ${automaticSelection.join(", ")}. Do not call the parent skill again for this selection.`
            : "No task-relevant references were selected automatically in this call. Do not call the parent skill again unless the task changes."
          : undefined

      const output = [
        `## Skill: ${skill.name}`,
        "",
        `**Base directory**: ${dir}`,
        `**Source**: ${safeLocation}`,
        ...(skill.alternatives?.length ? [`**Shadowed definitions**: ${skill.alternatives.join(", ")}`] : []),
        reusedChunk
          ? `**Loaded earlier**: ${name}, current source confirmed`
          : `**Loaded**: ${name}, characters ${params.offset}–${nextOffset} of ${content.length}`,
        ...(dependencies.length
          ? [`**Required dependencies (load before mutation)**: ${dependencies.map((item) => item.name).join(", ")}`]
          : []),
        ...(remainingOffset < content.length
          ? [`**Remaining**: load ${name} with offset=${remainingOffset}. Required content is not fully loaded yet.`]
          : []),
        ...(references.length
          ? [
              "",
              automaticSelectionNotice ??
                "Read the parent routing instructions, then select required references with references=[relative paths] and reason. Load any omitted selected chunks before editing or completing.",
              "**References (load with skill tool):**",
              ...references.map((ref) => `- ${skill.name}/${ref.relative}: ${ref.route}`),
            ]
          : []),
        "",
        loadedText || "Instructions already loaded from current source; reuse the earlier instructions.",
        ...routed.entries,
        ...(routed.remaining.length
          ? [
              "References omitted from this result; use confirmed earlier chunks or load before relying on them:",
              ...routed.remaining.map((ref) => `- ${ref.name}, offset=${ref.offset}: ${ref.reason}`),
            ]
          : []),
      ].join("\n")

      return {
        title: `Loaded skill: ${skill.name}`,
        output,
        metadata: {
          name: skill.name,
          dir,
          url: "",
          description: "",
          location: safeLocation,
          reference: name,
          offset: params.offset,
          length: loadedText.length,
          totalChars: content.length,
          contentHash: Skill.loadedChunk(name, safeLocation, content, params.offset, loadedText.length).contentHash,
          ...(params.references !== undefined
            ? { selectedReferences: [...new Set(selectedReferences)], selectionReason: params.reason!.trim() }
            : automaticSelection !== undefined && references.length > 0
              ? {
                  selectedReferences: [...new Set(automaticSelection)],
                  selectionReason:
                    automaticSelection.length > 0
                      ? "Automatically selected from the task"
                      : "No task-relevant references were selected automatically",
                }
              : {}),
          loadedReferences: routed.loaded,
          remainingReferences: routed.remaining,
        },
      }
    },
  }
})
