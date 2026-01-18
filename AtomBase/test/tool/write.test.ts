import { describe, expect, test } from "bun:test"
import path from "path"
import { WriteTool } from "../../src/tool/write"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "../../src/permission/next"
import { FileTime } from "../../src/file/time"

const ctx = {
    sessionID: "test",
    messageID: "",
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    metadata: () => { },
    ask: async () => { },
}

describe("tool.write", () => {
    test("write new file", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const filePath = path.join(tmp.path, "new-file.txt")
                const write = await WriteTool.init()

                const result = await write.execute(
                    {
                        filePath,
                        content: "Hello World",
                    },
                    ctx,
                )

                const content = await Bun.file(filePath).text()
                expect(content).toBe("Hello World")
                expect(result.metadata.filepath).toBe(filePath)
                expect(result.metadata.exists).toBe(false)
            },
        })
    })

    test("overwrite existing file", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const filePath = path.join(tmp.path, "existing.txt")
                await Bun.write(filePath, "Original content")
                FileTime.read(ctx.sessionID, filePath) // Required before overwrite

                const write = await WriteTool.init()
                await write.execute(
                    {
                        filePath,
                        content: "New content",
                    },
                    ctx,
                )

                const content = await Bun.file(filePath).text()
                expect(content).toBe("New content")
            },
        })
    })

    test("write empty file", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const filePath = path.join(tmp.path, "empty.txt")
                const write = await WriteTool.init()

                await write.execute(
                    {
                        filePath,
                        content: "",
                    },
                    ctx,
                )

                const content = await Bun.file(filePath).text()
                expect(content).toBe("")
            },
        })
    })

    test("write creates parent directories", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const filePath = path.join(tmp.path, "nested", "deep", "file.txt")
                const write = await WriteTool.init()

                await write.execute(
                    {
                        filePath,
                        content: "Nested content",
                    },
                    ctx,
                )

                const content = await Bun.file(filePath).text()
                expect(content).toBe("Nested content")
            },
        })
    })

    test("write with relative path normalizes to absolute", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const write = await WriteTool.init()
                const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
                const testCtx = {
                    ...ctx,
                    ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
                        requests.push(req)
                    },
                }

                await write.execute(
                    {
                        filePath: "relative-file.txt",
                        content: "Relative path content",
                    },
                    testCtx,
                )

                expect(requests.length).toBe(1)
                expect(requests[0].metadata?.filepath).toBe(path.join(tmp.path, "relative-file.txt"))
            },
        })
    })
})

describe("tool.write permissions", () => {
    test("asks for edit permission with correct pattern", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const filePath = path.join(tmp.path, "test.txt")
                const write = await WriteTool.init()
                const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
                const testCtx = {
                    ...ctx,
                    ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
                        requests.push(req)
                    },
                }

                await write.execute(
                    {
                        filePath,
                        content: "Test content",
                    },
                    testCtx,
                )

                expect(requests.length).toBe(1)
                expect(requests[0].permission).toBe("edit")
                expect(requests[0].patterns).toContain("test.txt")
                expect(requests[0].metadata?.filepath).toBe(filePath)
                expect(requests[0].metadata?.diff).toBeDefined()
            },
        })
    })

    test("asks for external_directory permission for files outside project", async () => {
        await using tmp = await tmpdir({ git: true })
        await using externalTmp = await tmpdir({ git: false })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const externalPath = path.join(externalTmp.path, "external.txt")
                const write = await WriteTool.init()
                const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
                const testCtx = {
                    ...ctx,
                    ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
                        requests.push(req)
                    },
                }

                await write.execute(
                    {
                        filePath: externalPath,
                        content: "External content",
                    },
                    testCtx,
                )

                const extDirReq = requests.find((r) => r.permission === "external_directory")
                expect(extDirReq).toBeDefined()
            },
        })
    })
})

describe("tool.write special content", () => {
    test("write unicode content", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const filePath = path.join(tmp.path, "unicode.txt")
                const write = await WriteTool.init()
                const unicodeContent = "Merhaba Dünya 🌍 日本語 العربية"

                await write.execute(
                    {
                        filePath,
                        content: unicodeContent,
                    },
                    ctx,
                )

                const content = await Bun.file(filePath).text()
                expect(content).toBe(unicodeContent)
            },
        })
    })

    test("write multiline content", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const filePath = path.join(tmp.path, "multiline.txt")
                const write = await WriteTool.init()
                const multilineContent = `Line 1
Line 2
Line 3`

                await write.execute(
                    {
                        filePath,
                        content: multilineContent,
                    },
                    ctx,
                )

                const content = await Bun.file(filePath).text()
                expect(content).toBe(multilineContent)
                expect(content.split("\n").length).toBe(3)
            },
        })
    })

    test("write code content", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const filePath = path.join(tmp.path, "code.ts")
                const write = await WriteTool.init()
                const codeContent = `export function hello(name: string): string {
  return \`Hello, \${name}!\`
}

export const PI = 3.14159`

                await write.execute(
                    {
                        filePath,
                        content: codeContent,
                    },
                    ctx,
                )

                const content = await Bun.file(filePath).text()
                expect(content).toBe(codeContent)
                expect(content).toContain("export function hello")
                expect(content).toContain("export const PI")
            },
        })
    })
})
