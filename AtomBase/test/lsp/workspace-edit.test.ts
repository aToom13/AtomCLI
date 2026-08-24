import "../preload"
import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { LSPWorkspaceEdit } from "@/integrations/lsp/workspace-edit"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("LSPWorkspaceEdit", () => {
  test("applies validated edits across files with one authorization", async () => {
    await using tmp = await tmpdir({ git: true })
    const first = path.join(tmp.path, "first.ts")
    const second = path.join(tmp.path, "second.ts")
    await Bun.write(first, "export const value = 1\n")
    await Bun.write(second, "import { value } from './first'\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const authorizations: LSPWorkspaceEdit.Authorization[] = []
        const result = await LSPWorkspaceEdit.apply({
          sessionID: "workspace-edit-test",
          edit: {
            changes: {
              [pathToFileURL(first).href]: [
                {
                  range: { start: { line: 0, character: 13 }, end: { line: 0, character: 18 } },
                  newText: "answer",
                },
              ],
              [pathToFileURL(second).href]: [
                {
                  range: { start: { line: 0, character: 9 }, end: { line: 0, character: 14 } },
                  newText: "answer",
                },
              ],
            },
          },
          authorize: async (authorization) => {
            authorizations.push(authorization)
          },
        })

        expect(await Bun.file(first).text()).toBe("export const answer = 1\n")
        expect(await Bun.file(second).text()).toBe("import { answer } from './first'\n")
        expect(authorizations).toHaveLength(1)
        expect(result.textEdits).toBe(2)
        expect(result.changedFiles).toEqual([first, second])
      },
    })
  })

  test("rejects overlapping edits before authorization and leaves content untouched", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "overlap.ts")
    await Bun.write(file, "abcdef")
    let authorizations = 0

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(
          LSPWorkspaceEdit.apply({
            sessionID: "workspace-edit-test",
            edit: {
              changes: {
                [pathToFileURL(file).href]: [
                  { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } }, newText: "X" },
                  { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 5 } }, newText: "Y" },
                ],
              },
            },
            authorize: async () => {
              authorizations++
            },
          }),
        ).rejects.toThrow(/Overlapping LSP text edits/)
      },
    })

    expect(await Bun.file(file).text()).toBe("abcdef")
    expect(authorizations).toBe(0)
  })

  test("rechecks every file after authorization and rejects concurrent changes atomically", async () => {
    await using tmp = await tmpdir({ git: true })
    const first = path.join(tmp.path, "first.ts")
    const second = path.join(tmp.path, "second.ts")
    await Bun.write(first, "one")
    await Bun.write(second, "two")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(
          LSPWorkspaceEdit.apply({
            sessionID: "workspace-edit-test",
            edit: {
              changes: {
                [pathToFileURL(first).href]: [
                  { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: "ONE" },
                ],
                [pathToFileURL(second).href]: [
                  { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: "TWO" },
                ],
              },
            },
            authorize: async () => {
              await Bun.write(second, "external")
            },
          }),
        ).rejects.toThrow(/Stale LSP workspace edit/)
      },
    })

    expect(await Bun.file(first).text()).toBe("one")
    expect(await Bun.file(second).text()).toBe("external")
  })

  test("applies import edits and a file rename as one workspace operation", async () => {
    await using tmp = await tmpdir({ git: true })
    const source = path.join(tmp.path, "old-name.ts")
    const destination = path.join(tmp.path, "new-name.ts")
    const consumer = path.join(tmp.path, "consumer.ts")
    await Bun.write(source, "export const value = 1\n")
    await Bun.write(consumer, "import { value } from './old-name'\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await LSPWorkspaceEdit.apply({
          sessionID: "workspace-edit-test",
          edit: {
            changes: {
              [pathToFileURL(consumer).href]: [
                {
                  range: { start: { line: 0, character: 25 }, end: { line: 0, character: 33 } },
                  newText: "new-name",
                },
              ],
            },
          },
          additionalRenames: [{ oldPath: source, newPath: destination }],
          authorize: async () => {},
        })

        expect(await Bun.file(source).exists()).toBe(false)
        expect(await Bun.file(destination).text()).toBe("export const value = 1\n")
        expect(await Bun.file(consumer).text()).toBe("import { value } from './new-name'\n")
        expect(result.resourceOperations).toBe(1)
      },
    })
  })

  test("rejects stale document versions", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "versioned.ts")
    await Bun.write(file, "value")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(
          LSPWorkspaceEdit.apply({
            sessionID: "workspace-edit-test",
            edit: {
              documentChanges: [
                {
                  textDocument: { uri: pathToFileURL(file).href, version: 4 },
                  edits: [
                    {
                      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
                      newText: "updated",
                    },
                  ],
                },
              ],
            },
            version: async () => 3,
            authorize: async () => {},
          }),
        ).rejects.toThrow(/expected document version 4, current version 3/)
      },
    })

    expect(await Bun.file(file).text()).toBe("value")
  })

  test("rolls back earlier resource operations when a later apply step fails", async () => {
    await using tmp = await tmpdir({ git: true })
    const source = path.join(tmp.path, "source.ts")
    const destination = path.join(tmp.path, "destination.ts")
    const blocker = path.join(tmp.path, "blocked")
    const impossible = path.join(blocker, "created.ts")
    await Bun.write(source, "original")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(
          LSPWorkspaceEdit.apply({
            sessionID: "workspace-edit-test",
            edit: {
              documentChanges: [
                { kind: "rename", oldUri: pathToFileURL(source).href, newUri: pathToFileURL(destination).href },
                { kind: "create", uri: pathToFileURL(impossible).href },
              ],
            },
            authorize: async () => {
              await Bun.write(blocker, "prevents directory creation")
            },
          }),
        ).rejects.toThrow(/all file changes were rolled back/)
      },
    })

    expect(await Bun.file(source).text()).toBe("original")
    expect(await Bun.file(destination).exists()).toBe(false)
    expect(await Bun.file(blocker).text()).toBe("prevents directory creation")
  })
})
