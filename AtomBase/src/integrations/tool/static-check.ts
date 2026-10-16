import z from "zod"
import path from "path"
import fs from "fs/promises"
import { Tool } from "./tool"
import DESCRIPTION from "./static-check.txt"
import { StaticGate } from "@/core/verification/static-gate"
import { Instance } from "@/services/project/instance"
import { assertExternalDirectory } from "./external-directory"
import { ToolNotAppliedError } from "./runtime-error"

const MAX_CONTENT_BYTES = 20 * 1024 * 1024

/**
 * Deterministic, LLM-free quality gate for JavaScript/HTML artifacts.
 *
 * `node --check` only validates syntax, so an undefined identifier (`undef`),
 * a redeclared block-scoped binding, or a half-finished refactor survives the
 * build and only fails at runtime. This tool runs the scope-aware StaticGate on
 * a file (or on inline content) and reports those defects before the model
 * spends reasoning tokens hunting them at runtime.
 */
export const StaticCheckTool = Tool.define("static_check", {
  description: DESCRIPTION,
  mutating: false,
  effects: {
    workspace: "read",
    external: "none",
    reversible: true,
    destructive: false,
    privileged: false,
  },
  parameters: z.object({
    file: z.string().max(4096).optional().describe("Absolute path to a JavaScript/HTML/TypeScript file to check."),
    content: z
      .string()
      .max(MAX_CONTENT_BYTES)
      .optional()
      .describe("Inline source to check instead of a file (for pre-write validation)."),
    globals: z
      .array(z.string())
      .max(500)
      .optional()
      .describe("Extra identifiers to treat as ambient globals (project-provided globals)."),
  }),
  async execute(params, ctx) {
    if (!params.file && params.content === undefined) {
      throw new ToolNotAppliedError(new Error("static_check requires either `file` or `content`."))
    }
    if (params.file && params.content) {
      throw new ToolNotAppliedError(
        new Error(
          "static_check received invalid arguments: use `file` or `content`, not both; omit content for a file check.",
        ),
      )
    }

    let source = params.content ?? ""
    let label = "content"
    if (params.file) {
      const filepath = path.isAbsolute(params.file) ? params.file : path.join(Instance.directory, params.file)
      await assertExternalDirectory(ctx, filepath)
      const canonical = await fs.realpath(filepath)
      await assertExternalDirectory(ctx, canonical)
      await ctx.ask({
        permission: "read",
        patterns: [...new Set([filepath, canonical])],
        always: ["*"],
        metadata: { filepath },
      })
      if ((await fs.realpath(filepath)) !== canonical)
        throw new ToolNotAppliedError(new Error("Static check target changed while awaiting permission"))
      const file = Bun.file(canonical)
      const stats = await file.stat().catch(() => undefined)
      if (!stats) throw new Error(`File not found: ${filepath}`)
      if (stats.isDirectory()) throw new Error(`Path is a directory, not a file: ${filepath}`)
      if (stats.size > MAX_CONTENT_BYTES) throw new Error(`File exceeds the ${MAX_CONTENT_BYTES} byte gate limit`)
      source = await file.text()
      label = filepath
    }

    const result = StaticGate.checkFile(params.file ? label : "content.js", source, { globals: params.globals })
    const output = StaticGate.format(result, label)
    await ctx.metadata({ title: `static_check: ${result.ok ? "pass" : `${result.diagnostics.length} issue(s)`}` })
    return {
      title: result.ok ? "Static gate passed" : `Static gate failed (${result.diagnostics.length})`,
      metadata: {
        status: result.ok ? "passed" : "failed",
        ok: result.ok,
        analyzable: result.analyzable,
        diagnostics: result.diagnostics,
        stats: result.stats,
      },
      output,
    }
  },
})
