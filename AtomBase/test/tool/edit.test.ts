import { describe, expect, test } from "bun:test"
import path from "path"
import { EditTool } from "@/integrations/tool/edit"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "@/util/permission/next"
import { FileTime } from "@/services/file/time"

const ctx = {
    sessionID: "test",
    messageID: "",
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    metadata: () => { },
    ask: async () => { },
}

// Helper to mark file as read before editing (required by FileTime.assert)
function markFileAsRead(filepath: string) {
    FileTime.read(ctx.sessionID, filepath)
}

describe("tool.edit", () => {
    test("applies multiple operations with one permission request and one combined result", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const filePath = path.join(tmp.path, "multi.txt")
                await Bun.write(filePath, "alpha beta gamma")
                markFileAsRead(filePath)
                const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
                const edit = await EditTool.init()
                const result = await edit.execute(
                    {
                        filePath,
                        operations: [
                            { oldString: "alpha", newString: "one" },
                            { oldString: "gamma", newString: "three" },
                        ],
                    },
                    { ...ctx, ask: async (request) => { requests.push(request) } },
                )

                expect(await Bun.file(filePath).text()).toBe("one beta three")
                expect(requests).toHaveLength(1)
                expect(requests[0].metadata?.diff).toContain("-alpha beta gamma")
                expect(requests[0].metadata?.diff).toContain("+one beta three")
                expect(result.metadata.operations).toBe(2)
            },
        })
    })

    test("leaves the file unchanged when a later operation fails", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const filePath = path.join(tmp.path, "atomic.txt")
                const original = "alpha beta gamma"
                await Bun.write(filePath, original)
                markFileAsRead(filePath)
                let permissionRequests = 0
                const edit = await EditTool.init()

                await expect(
                    edit.execute(
                        {
                            filePath,
                            operations: [
                                { oldString: "alpha", newString: "one" },
                                { oldString: "missing", newString: "never-written" },
                            ],
                        },
                        { ...ctx, ask: async () => { permissionRequests++ } },
                    ),
                ).rejects.toThrow(/oldString not found/)
                expect(await Bun.file(filePath).text()).toBe(original)
                expect(permissionRequests).toBe(0)
            },
        })
    })

    test("rejects oversized existing files and replacement expansion", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const edit = await EditTool.init()
                const oversized = path.join(tmp.path, "oversized.txt")
                await Bun.write(oversized, "x".repeat(10 * 1024 * 1024 + 1))
                markFileAsRead(oversized)
                await expect(
                    edit.execute({ filePath: oversized, oldString: "x", newString: "y" }, ctx),
                ).rejects.toThrow(/byte edit limit/)

                const expansion = path.join(tmp.path, "expansion.txt")
                await Bun.write(expansion, "x".repeat(6 * 1024 * 1024))
                markFileAsRead(expansion)
                await expect(
                    edit.execute({ filePath: expansion, oldString: "x", newString: "xx", replaceAll: true }, ctx),
                ).rejects.toThrow(/Edited content exceeds/)
                expect((await Bun.file(expansion).stat()).size).toBe(6 * 1024 * 1024)
            },
        })
    })

    test("basic edit - replace single occurrence", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const filePath = path.join(tmp.path, "test.txt")
                await Bun.write(filePath, "Hello World")
                markFileAsRead(filePath) // Required before edit

                const edit = await EditTool.init()
                const result = await edit.execute(
                    {
                        filePath,
                        oldString: "World",
                        newString: "Universe",
                    },
                    ctx,
                )

                const content = await Bun.file(filePath).text()
                expect(content).toBe("Hello Universe")
            },
        })
    })

    test("edit with replaceAll=true", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const filePath = path.join(tmp.path, "test.txt")
                await Bun.write(filePath, "foo bar foo baz foo")
                markFileAsRead(filePath)

                const edit = await EditTool.init()
                await edit.execute(
                    {
                        filePath,
                        oldString: "foo",
                        newString: "qux",
                        replaceAll: true,
                    },
                    ctx,
                )

                const content = await Bun.file(filePath).text()
                expect(content).toBe("qux bar qux baz qux")
            },
        })
    })

    test("edit with replaceAll=false rejects multiple matches", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const filePath = path.join(tmp.path, "test.txt")
                await Bun.write(filePath, "foo bar foo baz foo")
                markFileAsRead(filePath)

                const edit = await EditTool.init()
                // When replaceAll is false and multiple matches exist, it should throw
                await expect(
                    edit.execute(
                        {
                            filePath,
                            oldString: "foo",
                            newString: "qux",
                            replaceAll: false,
                        },
                        ctx,
                    ),
                ).rejects.toThrow(/multiple matches/)
            },
        })
    })

    test("edit non-existent file throws error", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const filePath = path.join(tmp.path, "nonexistent.txt")
                const edit = await EditTool.init()

                await expect(
                    edit.execute(
                        {
                            filePath,
                            oldString: "hello",
                            newString: "world",
                        },
                        ctx,
                    ),
                ).rejects.toThrow(/not found/)
            },
        })
    })

    test("edit with empty oldString creates new file", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const filePath = path.join(tmp.path, "new-file.txt")
                const edit = await EditTool.init()

                await edit.execute(
                    {
                        filePath,
                        oldString: "",
                        newString: "New file content",
                    },
                    ctx,
                )

                const content = await Bun.file(filePath).text()
                expect(content).toBe("New file content")
            },
        })
    })

    test("edit with same oldString and newString throws error", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const filePath = path.join(tmp.path, "test.txt")
                await Bun.write(filePath, "Hello World")

                const edit = await EditTool.init()

                await expect(
                    edit.execute(
                        {
                            filePath,
                            oldString: "World",
                            newString: "World",
                        },
                        ctx,
                    ),
                ).rejects.toThrow(/different/)
            },
        })
    })

    test("edit directory path throws error", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const edit = await EditTool.init()

                await expect(
                    edit.execute(
                        {
                            filePath: tmp.path,
                            oldString: "hello",
                            newString: "world",
                        },
                        ctx,
                    ),
                ).rejects.toThrow(/directory/)
            },
        })
    })
})

describe("tool.edit permissions", () => {
    test("asks for edit permission with correct pattern", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const filePath = path.join(tmp.path, "test.txt")
                await Bun.write(filePath, "Hello World")

                const edit = await EditTool.init()
                const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
                const testCtx = {
                    ...ctx,
                    ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
                        requests.push(req)
                    },
                }
                // Mark as read with test context's sessionID
                FileTime.read(testCtx.sessionID, filePath)

                await edit.execute(
                    {
                        filePath,
                        oldString: "World",
                        newString: "Universe",
                    },
                    testCtx,
                )

                expect(requests.length).toBe(1)
                expect(requests[0].permission).toBe("edit")
                expect(requests[0].metadata?.diff).toContain("-Hello World")
                expect(requests[0].metadata?.diff).toContain("+Hello Universe")
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
                await Bun.write(externalPath, "External content")

                const edit = await EditTool.init()
                const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
                const testCtx = {
                    ...ctx,
                    ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
                        requests.push(req)
                    },
                }
                FileTime.read(testCtx.sessionID, externalPath)

                await edit.execute(
                    {
                        filePath: externalPath,
                        oldString: "External",
                        newString: "Modified",
                    },
                    testCtx,
                )

                const extDirReq = requests.find((r) => r.permission === "external_directory")
                expect(extDirReq).toBeDefined()
            },
        })
    })
})

describe("tool.edit unicode and special characters", () => {
    test("edit with unicode characters", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const filePath = path.join(tmp.path, "unicode.txt")
                await Bun.write(filePath, "Merhaba Dünya 🌍")
                markFileAsRead(filePath)

                const edit = await EditTool.init()
                await edit.execute(
                    {
                        filePath,
                        oldString: "Dünya 🌍",
                        newString: "Evren 🚀",
                    },
                    ctx,
                )

                const content = await Bun.file(filePath).text()
                expect(content).toBe("Merhaba Evren 🚀")
            },
        })
    })

    test("edit with line endings (CRLF)", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const filePath = path.join(tmp.path, "crlf.txt")
                await Bun.write(filePath, "Line1\r\nLine2\r\nLine3")
                markFileAsRead(filePath)

                const edit = await EditTool.init()
                await edit.execute(
                    {
                        filePath,
                        oldString: "Line2",
                        newString: "Modified",
                    },
                    ctx,
                )

                const content = await Bun.file(filePath).text()
                expect(content).toContain("Modified")
            },
        })
    })

    test("edit multiline content", async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
            directory: tmp.path,
            fn: async () => {
                const filePath = path.join(tmp.path, "multiline.txt")
                await Bun.write(
                    filePath,
                    `function hello() {
  console.log("hello")
}`,
                )
                markFileAsRead(filePath)

                const edit = await EditTool.init()
                await edit.execute(
                    {
                        filePath,
                        oldString: `function hello() {
  console.log("hello")
}`,
                        newString: `function hello() {
  console.log("hello world")
  return true
}`,
                    },
                    ctx,
                )

                const content = await Bun.file(filePath).text()
                expect(content).toContain('console.log("hello world")')
                expect(content).toContain("return true")
            },
        })
    })
})
