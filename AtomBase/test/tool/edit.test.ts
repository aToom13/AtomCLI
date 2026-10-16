import "../preload"
import { describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { EditTool } from "@/integrations/tool/edit"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "@/util/permission/next"
import { FileTime } from "@/services/file/time"
import { EditAnchor } from "@/integrations/tool/edit-anchor"
import { ReadTool } from "@/integrations/tool/read"
import { WriteTool } from "@/integrations/tool/write"
import { ToolRuntime } from "@/integrations/tool/runtime"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

// Helper to mark file as read before editing (required by FileTime.assert)
function markFileAsRead(filepath: string) {
  FileTime.read(ctx.sessionID, filepath)
}

describe("tool.edit", () => {
  test("supplies an authorized read snapshot after an unread edit attempt", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "unread.txt")
        await Bun.write(filePath, "first line\nsecond line\nreplace me\nlast line")
        const edit = await EditTool.init()
        const input = { filePath, oldString: "replace me", newString: "fixed" }
        const error = await edit.execute(input, ctx).catch((error) => error)

        expect(error).toBeInstanceOf(ToolRuntime.NotAppliedError)
        expect(String(error)).toContain("replace me")
        expect(String(error)).toContain(EditAnchor.contentHash(await Bun.file(filePath).text()))
        expect(await Bun.file(filePath).text()).toContain("replace me")

        await edit.execute(input, ctx)
        expect(await Bun.file(filePath).text()).toContain("fixed")
      },
    })
  })

  test("does not reveal an unread file when read permission is denied", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "read-denied.txt")
        await Bun.write(filePath, "private content")
        const edit = await EditTool.init()
        const denied = {
          ...ctx,
          ask: async (request: { permission: string }) => {
            if (request.permission === "read") throw new Error("read denied")
          },
        }
        const error = await edit
          .execute({ filePath, oldString: "private", newString: "public" }, denied)
          .catch((error) => error)
        expect(error).toBeInstanceOf(ToolRuntime.NotAppliedError)
        expect(String(error)).not.toContain("private content")
        expect(await Bun.file(filePath).text()).toBe("private content")
      },
    })
  })

  test("uses oldString and newString when operations is empty", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "empty-operations.txt")
        await Bun.write(filePath, "before")
        markFileAsRead(filePath)
        const edit = await EditTool.init()

        const result = await edit.execute({ filePath, oldString: "before", newString: "after", operations: [] }, ctx)

        expect(await Bun.file(filePath).text()).toBe("after")
        expect(result.output).toContain("Edit applied.")
      },
    })
  })

  test("rejects mixed edit modes without silently dropping a replacement", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "mixed.txt")
        await Bun.write(filePath, "hud below canvas\nconst restart = undefined")
        markFileAsRead(filePath)
        const edit = await EditTool.init()
        const operations = [{ oldString: "undefined", newString: "button" }]
        const error = await edit
          .execute({ filePath, oldString: "below", newString: "above", operations }, ctx)
          .catch((error) => error)
        expect(error).toBeInstanceOf(ToolRuntime.NotAppliedError)
        expect(String(error)).toContain("mixed edits are not applied")
        expect(await Bun.file(filePath).text()).toBe("hud below canvas\nconst restart = undefined")

        await edit.execute({ filePath, oldString: "", newString: "", operations }, ctx)
        expect(await Bun.file(filePath).text()).toBe("hud below canvas\nconst restart = button")
      },
    })
  })

  test("marks permission-denied writes as not applied", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "permission-denied.txt")
        await Bun.write(filePath, "before")
        markFileAsRead(filePath)
        const write = spyOn(Bun, "write").mockRejectedValue(
          Object.assign(new Error("permission denied"), { code: "EACCES" }),
        )
        try {
          const edit = await EditTool.init()
          await expect(edit.execute({ filePath, oldString: "before", newString: "after" }, ctx)).rejects.toBeInstanceOf(
            ToolRuntime.NotAppliedError,
          )
        } finally {
          write.mockRestore()
        }
      },
    })
  })

  test("applies a content-hash guarded edit and returns the new hash", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "guarded.txt")
        await Bun.write(filePath, "alpha beta")
        const read = await ReadTool.init()
        const snapshot = await read.execute({ filePath }, ctx)
        const edit = await EditTool.init()
        const result = await edit.execute(
          {
            filePath,
            oldString: "beta",
            newString: "gamma",
            contentHash: snapshot.metadata.contentHash,
          },
          ctx,
        )

        expect(await Bun.file(filePath).text()).toBe("alpha gamma")
        expect(result.metadata.contentHashBefore).toBe(snapshot.metadata.contentHash)
        expect(result.metadata.contentHashAfter).toBe(EditAnchor.contentHash("alpha gamma"))
      },
    })
  })

  test("binds omitted hashes to trusted reads and rejects backdated external changes", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "remembered.txt")
        const executionCtx = { ...ctx, extra: { execution: { executionID: "remembered-read" } } }
        await Bun.write(filePath, "alpha beta")
        await (await ReadTool.init()).execute({ filePath }, executionCtx)
        const edit = await EditTool.init()
        await edit.execute({ filePath, oldString: "alpha", newString: "first" }, executionCtx)
        await edit.execute({ filePath, oldString: "beta", newString: "next" }, executionCtx)
        expect(await Bun.file(filePath).text()).toBe("first next")
        await Bun.write(filePath, "first zeta")
        const { utimes } = await import("fs/promises")
        await utimes(filePath, new Date(0), new Date(0))
        await expect(edit.execute({ filePath, oldString: "first", newString: "other" }, executionCtx)).rejects.toThrow(
          /Stale edit: content changed/,
        )
        expect(await Bun.file(filePath).text()).toBe("first zeta")
      },
    })
  })

  test("an explicit incorrect hash is never replaced by remembered read evidence", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "explicit-hash.txt")
        const executionCtx = { ...ctx, extra: { execution: { executionID: "explicit-read" } } }
        await Bun.write(filePath, "alpha beta")
        await (await ReadTool.init()).execute({ filePath }, executionCtx)
        await expect(
          (await EditTool.init()).execute(
            { filePath, oldString: "beta", newString: "gamma", contentHash: "sha256:" + "0".repeat(64) },
            executionCtx,
          ),
        ).rejects.toThrow(/Stale edit: content changed/)
        expect(await Bun.file(filePath).text()).toBe("alpha beta")
      },
    })
  })

  test("native writes advance remembered hashes and reject backdated external overwrites", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "shared-revision.txt")
        const executionCtx = { ...ctx, extra: { execution: { executionID: "shared-revision" } } }
        await Bun.write(filePath, "alpha beta")
        await (await ReadTool.init()).execute({ filePath }, executionCtx)
        const write = await WriteTool.init()
        await write.execute({ filePath, content: "alpha gamma" }, executionCtx)
        await (await EditTool.init()).execute({ filePath, oldString: "alpha", newString: "first" }, executionCtx)
        expect(await Bun.file(filePath).text()).toBe("first gamma")
        await Bun.write(filePath, "first delta")
        const { utimes } = await import("fs/promises")
        await utimes(filePath, new Date(0), new Date(0))
        await expect(write.execute({ filePath, content: "replacement" }, executionCtx)).rejects.toThrow(
          /Stale write: content changed/,
        )
        expect(await Bun.file(filePath).text()).toBe("first delta")
      },
    })
  })

  test("accepts a prior read hash for later edits in the same execution only", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "revision.txt")
        await Bun.write(filePath, "alpha beta gamma")
        const read = await ReadTool.init()
        const snapshot = await read.execute({ filePath }, ctx)
        const edit = await EditTool.init()
        const executionCtx = { ...ctx, extra: { execution: { executionID: "revision-test" } } }

        await edit.execute(
          { filePath, oldString: "alpha", newString: "one", contentHash: snapshot.metadata.contentHash },
          executionCtx,
        )
        await edit.execute(
          { filePath, oldString: "beta", newString: "two", contentHash: snapshot.metadata.contentHash },
          executionCtx,
        )
        expect(await Bun.file(filePath).text()).toBe("one two gamma")

        await expect(
          edit.execute(
            { filePath, oldString: "gamma", newString: "three", contentHash: snapshot.metadata.contentHash },
            { ...ctx, extra: { execution: { executionID: "other-execution" } } },
          ),
        ).rejects.toThrow(/Stale edit: content changed/)

        await Bun.write(filePath, "external change")
        await expect(
          edit.execute(
            { filePath, oldString: "external", newString: "agent", contentHash: snapshot.metadata.contentHash },
            executionCtx,
          ),
        ).rejects.toThrow(/Stale edit: content changed/)
      },
    })
  })

  test("rebases a read anchor after its own earlier edit shifts the target line", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "rebase-anchor.txt")
        await Bun.write(filePath, "header\nrepeat\nfirst end\nsection\nrepeat\nsecond end")
        const executionCtx = { ...ctx, extra: { execution: { executionID: "anchor-rebase" } } }
        const read = await ReadTool.init()
        const snapshot = await read.execute({ filePath, offset: 3, limit: 3 }, executionCtx)
        const edit = await EditTool.init()

        await edit.execute(
          { filePath, oldString: "header", newString: "header\nnew line", contentHash: snapshot.metadata.contentHash },
          executionCtx,
        )
        await edit.execute(
          {
            filePath,
            oldString: "repeat",
            newString: "changed",
            contentHash: snapshot.metadata.contentHash,
            startAnchor: snapshot.metadata.startAnchor,
            endAnchor: snapshot.metadata.endAnchor,
          },
          executionCtx,
        )

        expect(await Bun.file(filePath).text()).toBe(
          "header\nnew line\nrepeat\nfirst end\nsection\nchanged\nsecond end",
        )
      },
    })
  })

  test("rejects a tracked anchor when an own edit crosses its boundary", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "crossed-anchor.txt")
        await Bun.write(filePath, "outside\nsection\ntarget\nend")
        const executionCtx = { ...ctx, extra: { execution: { executionID: "anchor-crossing" } } }
        const read = await ReadTool.init()
        const snapshot = await read.execute({ filePath, offset: 1, limit: 2 }, executionCtx)
        const edit = await EditTool.init()

        await edit.execute(
          {
            filePath,
            oldString: "outside\nsection",
            newString: "merged\nsection changed",
            contentHash: snapshot.metadata.contentHash,
          },
          executionCtx,
        )
        await expect(
          edit.execute(
            {
              filePath,
              oldString: "target",
              newString: "changed",
              contentHash: snapshot.metadata.contentHash,
              startAnchor: snapshot.metadata.startAnchor,
              endAnchor: snapshot.metadata.endAnchor,
            },
            executionCtx,
          ),
        ).rejects.toThrow(/Stale edit: anchored content changed/)
        expect(await Bun.file(filePath).text()).toBe("merged\nsection changed\ntarget\nend")
      },
    })
  })

  test("rejects a stale content hash without writing or requesting permission", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "stale.txt")
        await Bun.write(filePath, "before")
        const read = await ReadTool.init()
        const snapshot = await read.execute({ filePath }, ctx)
        await Bun.write(filePath, "changed elsewhere")
        let permissionRequests = 0
        const edit = await EditTool.init()

        await expect(
          edit.execute(
            {
              filePath,
              oldString: "before",
              newString: "after",
              contentHash: snapshot.metadata.contentHash,
            },
            {
              ...ctx,
              ask: async () => {
                permissionRequests++
              },
            },
          ),
        ).rejects.toThrow(/Stale edit: content changed/)
        expect(await Bun.file(filePath).text()).toBe("changed elsewhere")
        expect(permissionRequests).toBe(0)
      },
    })
  })

  test("uses line anchors to disambiguate repeated text", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "repeated.txt")
        await Bun.write(filePath, "first\nrepeat me\nend first\nsecond\nrepeat me\nend second")
        const read = await ReadTool.init()
        const snapshot = await read.execute({ filePath, limit: 3 }, ctx)
        const edit = await EditTool.init()

        await edit.execute(
          {
            filePath,
            oldString: "repeat me",
            newString: "changed once",
            contentHash: snapshot.metadata.contentHash,
            startAnchor: snapshot.metadata.startAnchor,
            endAnchor: snapshot.metadata.endAnchor,
          },
          ctx,
        )

        expect(await Bun.file(filePath).text()).toBe("first\nchanged once\nend first\nsecond\nrepeat me\nend second")
      },
    })
  })

  test("applies repeated read anchors across a batch and leaves failed batches untouched", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "batch-anchor.txt")
        await Bun.write(filePath, "first\nsecond\nthird")
        const snapshot = await (await ReadTool.init()).execute({ filePath }, ctx)
        const edit = await EditTool.init()
        const anchor = { startAnchor: snapshot.metadata.startAnchor, endAnchor: snapshot.metadata.endAnchor }
        await expect(
          edit.execute(
            {
              filePath,
              contentHash: snapshot.metadata.contentHash,
              operations: [
                { oldString: "first", newString: "changed first", ...anchor },
                { oldString: "missing", newString: "changed", ...anchor },
              ],
            },
            ctx,
          ),
        ).rejects.toThrow(/oldString not found/)
        expect(await Bun.file(filePath).text()).toBe("first\nsecond\nthird")
        await edit.execute(
          {
            filePath,
            contentHash: snapshot.metadata.contentHash,
            operations: [
              { oldString: "first", newString: "changed first", ...anchor },
              { oldString: "second", newString: "changed second", ...anchor },
            ],
          },
          ctx,
        )
        expect(await Bun.file(filePath).text()).toBe("changed first\nchanged second\nthird")
      },
    })
  })

  test("rejects stale line anchors even when the read timestamp is refreshed", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "anchor-stale.txt")
        await Bun.write(filePath, "start\ntarget\nend")
        const read = await ReadTool.init()
        const snapshot = await read.execute({ filePath }, ctx)
        await Bun.write(filePath, "changed\ntarget\nend")
        markFileAsRead(filePath)
        const edit = await EditTool.init()

        await expect(
          edit.execute(
            {
              filePath,
              oldString: "target",
              newString: "updated",
              startAnchor: snapshot.metadata.startAnchor,
              endAnchor: snapshot.metadata.endAnchor,
            },
            ctx,
          ),
        ).rejects.toThrow(/Stale edit: anchored content changed/)
        expect(await Bun.file(filePath).text()).toBe("changed\ntarget\nend")
      },
    })
  })

  test("rejects changes inside an anchored range when its boundary lines are unchanged", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "anchor-range-stale.txt")
        await Bun.write(filePath, "start\ntarget\nend")
        const read = await ReadTool.init()
        const snapshot = await read.execute({ filePath }, ctx)
        await Bun.write(filePath, "start\nchanged elsewhere\nend")
        markFileAsRead(filePath)
        const edit = await EditTool.init()

        await expect(
          edit.execute(
            {
              filePath,
              oldString: "changed elsewhere",
              newString: "agent change",
              startAnchor: snapshot.metadata.startAnchor,
              endAnchor: snapshot.metadata.endAnchor,
            },
            ctx,
          ),
        ).rejects.toThrow(/Stale edit: anchored content changed/)
        expect(await Bun.file(filePath).text()).toBe("start\nchanged elsewhere\nend")
      },
    })
  })

  test("detects a concurrent modification while awaiting permission", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "concurrent.txt")
        await Bun.write(filePath, "original")
        const read = await ReadTool.init()
        const snapshot = await read.execute({ filePath }, ctx)
        const edit = await EditTool.init()

        await expect(
          edit.execute(
            {
              filePath,
              oldString: "original",
              newString: "agent edit",
              contentHash: snapshot.metadata.contentHash,
            },
            {
              ...ctx,
              ask: async () => {
                await Bun.write(filePath, "external edit")
              },
            },
          ),
        ).rejects.toThrow(/while awaiting permission/)
        expect(await Bun.file(filePath).text()).toBe("external edit")
      },
    })
  })

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
          {
            ...ctx,
            ask: async (request) => {
              requests.push(request)
            },
          },
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
            {
              ...ctx,
              ask: async () => {
                permissionRequests++
              },
            },
          ),
        ).rejects.toBeInstanceOf(ToolRuntime.NotAppliedError)
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
        await expect(edit.execute({ filePath: oversized, oldString: "x", newString: "y" }, ctx)).rejects.toThrow(
          /byte edit limit/,
        )

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
        ).rejects.toBeInstanceOf(ToolRuntime.NotAppliedError)
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
