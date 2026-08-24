import "../preload"
import { describe, expect, test } from "bun:test"
import path from "path"
import { LspTool } from "@/integrations/tool/lsp"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "lsp-tool-test",
  messageID: "message",
  callID: "call",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: async () => {},
  ask: async () => {},
}

describe("tool.lsp", () => {
  test("requires a workspace symbol query and positions only for position operations", async () => {
    const tool = await LspTool.init()

    await expect(
      tool.execute(
        {
          operation: "workspaceSymbol",
          filePath: "src/index.ts",
        },
        ctx,
      ),
    ).rejects.toThrow("query is required for workspaceSymbol")

    await expect(
      tool.execute(
        {
          operation: "hover",
          filePath: "src/index.ts",
        },
        ctx,
      ),
    ).rejects.toThrow("line and character are required for hover")
  })

  test("uses the bundled TypeScript language server for go-to-definition", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "definition.ts")
    await Bun.write(path.join(tmp.path, "package.json"), JSON.stringify({ name: "lsp-fixture", private: true }))
    await Bun.write(
      path.join(tmp.path, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext" }, include: ["*.ts"] }),
    )
    await Bun.write(
      path.join(tmp.path, "atomcli.json"),
      JSON.stringify({
        lsp: {
          eslint: { disabled: true },
          oxlint: { disabled: true },
          biome: { disabled: true },
        },
      }),
    )
    await Bun.write(
      file,
      [
        "export const answer = 42",
        "export const doubled = answer * 2",
        "export const tripled = answer * 3",
        "export const label = String(answer)",
        "",
      ].join("\n"),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await LspTool.init()
        const result = await tool.execute(
          {
            operation: "goToDefinition",
            filePath: file,
            line: 2,
            character: 24,
          },
          ctx,
        )

        expect(result.metadata.results).toBeGreaterThan(0)
        expect(result.output).toContain("definition.ts")
        expect(result.output).toContain('"line": 0')

        const symbols = await tool.execute(
          {
            operation: "workspaceSymbol",
            filePath: file,
            query: "answer",
            maxResults: 1,
          },
          ctx,
        )

        expect(symbols.metadata.returned).toBeLessThanOrEqual(1)
        expect(symbols.metadata.results).toBeGreaterThan(0)
        expect(symbols.metadata.query).toBe("answer")
        expect(symbols.output).toContain("answer")
        expect(symbols.output).not.toContain('"name": "_"')

        const references = await tool.execute(
          {
            operation: "findReferences",
            filePath: file,
            line: 2,
            character: 24,
            maxResults: 2,
          },
          ctx,
        )

        expect(references.metadata.results).toBeGreaterThan(2)
        expect(references.metadata.returned).toBe(2)
        expect(references.metadata.omitted).toBe(references.metadata.results - 2)
        expect(references.metadata.limited).toBe(true)
        expect(references.output).toContain("increase maxResults")
      },
    })
  }, 30_000)
})
