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

    await expect(
      tool.execute(
        {
          operation: "renameSymbol",
          filePath: "src/index.ts",
          line: 1,
          character: 1,
        },
        ctx,
      ),
    ).rejects.toThrow("newName is required for renameSymbol")

    await expect(
      tool.execute(
        {
          operation: "codeActions",
          filePath: "src/index.ts",
          line: 1,
          character: 1,
          apply: true,
        },
        ctx,
      ),
    ).rejects.toThrow("actionIndex is required")
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

        const renamed = await tool.execute(
          {
            operation: "renameSymbol",
            filePath: file,
            line: 2,
            character: 24,
            newName: "renamedAnswer",
          },
          ctx,
        )

        expect(renamed.metadata.textEdits).toBeGreaterThanOrEqual(4)
        expect(renamed.metadata.changedFiles).toEqual([file])
        expect(await Bun.file(file).text()).toContain("export const renamedAnswer = 42")
        expect((await Bun.file(file).text()).match(/renamedAnswer/g)).toHaveLength(4)
      },
    })
  }, 30_000)

  test("returns diagnostics and type definitions from the bundled TypeScript server", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "diagnostics.ts")
    await Bun.write(path.join(tmp.path, "package.json"), JSON.stringify({ name: "lsp-fixture", private: true }))
    await Bun.write(
      path.join(tmp.path, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, target: "ES2022", module: "ESNext" }, include: ["*.ts"] }),
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
        "type User = { name: string }",
        "const user: User = { name: 'Ada' }",
        "export const name = user.name",
        "export const broken: string = 1",
        "",
      ].join("\n"),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await LspTool.init()
        const diagnostics = await tool.execute({ operation: "diagnostics", filePath: file }, ctx)
        expect(diagnostics.output).toContain("not assignable to type 'string'")

        const definition = await tool.execute(
          {
            operation: "typeDefinition",
            filePath: file,
            line: 3,
            character: 22,
          },
          ctx,
        )
        expect(definition.output).toContain("diagnostics.ts")
        expect(definition.output).toContain('"line": 0')
      },
    })
  }, 30_000)

  test("formats documents, lists code actions, and renames files with reference updates", async () => {
    await using tmp = await tmpdir({ git: true })
    const source = path.join(tmp.path, "old-name.ts")
    const destination = path.join(tmp.path, "new-name.ts")
    const consumer = path.join(tmp.path, "consumer.ts")
    const actionsFile = path.join(tmp.path, "actions.ts")
    await Bun.write(path.join(tmp.path, "package.json"), JSON.stringify({ name: "lsp-fixture", private: true }))
    await Bun.write(
      path.join(tmp.path, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true, noUnusedLocals: true, target: "ES2022", module: "ESNext" },
        include: ["*.ts"],
      }),
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
    await Bun.write(source, "export const value=1\n")
    await Bun.write(consumer, "import {value} from './old-name'\nexport const doubled=value*2\n")
    await Bun.write(actionsFile, "const unused = 1\nexport const kept = 2\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await LspTool.init()
        const permissionRequests: string[] = []
        const mutationCtx = {
          ...ctx,
          ask: async (request: { permission: string }) => {
            permissionRequests.push(request.permission)
          },
        }
        const formatted = await tool.execute(
          {
            operation: "formatting",
            filePath: consumer,
            tabSize: 2,
            insertSpaces: true,
          },
          mutationCtx,
        )
        expect(formatted.metadata.textEdits).toBeGreaterThan(0)
        expect(await Bun.file(consumer).text()).toContain("import { value } from './old-name'")
        expect(permissionRequests).toEqual(["lsp", "edit"])

        const actions = await tool.execute(
          {
            operation: "codeActions",
            filePath: actionsFile,
            line: 1,
            character: 1,
            endLine: 1,
            endCharacter: 17,
          },
          ctx,
        )
        expect(actions.metadata.results).toBeGreaterThan(0)
        expect(actions.output).toContain('"index": 0')

        const appliedAction = await tool.execute(
          {
            operation: "codeActions",
            filePath: actionsFile,
            line: 1,
            character: 1,
            endLine: 1,
            endCharacter: 17,
            apply: true,
            actionIndex: 0,
          },
          ctx,
        )
        expect(appliedAction.metadata.textEdits).toBeGreaterThan(0)
        expect(await Bun.file(actionsFile).text()).not.toContain("unused")

        await expect(tool.execute({ operation: "workspaceDiagnostics", filePath: actionsFile }, ctx)).rejects.toThrow(
          /supports workspace diagnostics/,
        )

        const renamed = await tool.execute(
          {
            operation: "renameFile",
            filePath: source,
            newFilePath: destination,
          },
          ctx,
        )
        expect(renamed.metadata.resourceOperations).toBeGreaterThanOrEqual(1)
        expect(await Bun.file(source).exists()).toBe(false)
        expect(await Bun.file(destination).exists()).toBe(true)
        expect(await Bun.file(consumer).text()).toContain("'./new-name'")
      },
    })
  }, 30_000)
})
