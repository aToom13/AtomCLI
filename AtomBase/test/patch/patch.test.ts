import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Patch } from "@/services/patch"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import * as fs from "fs/promises"
import * as path from "path"

describe("Patch namespace", () => {
  describe("parsePatch", () => {
    test("should parse simple add file patch", () => {
      const patchText = `*** Begin Patch
*** Add File: test.txt
+Hello World
*** End Patch`

      const result = Patch.parsePatch(patchText)
      expect(result.hunks).toHaveLength(1)
      expect(result.hunks[0]).toEqual({
        type: "add",
        path: "test.txt",
        contents: "Hello World",
      })
    })

    test("should parse delete file patch", () => {
      const patchText = `*** Begin Patch
*** Delete File: old.txt
*** End Patch`

      const result = Patch.parsePatch(patchText)
      expect(result.hunks).toHaveLength(1)
      const hunk = result.hunks[0]
      expect(hunk.type).toBe("delete")
      expect(hunk.path).toBe("old.txt")
    })

    test("should parse patch with multiple hunks", () => {
      const patchText = `*** Begin Patch
*** Add File: new.txt
+This is a new file
*** Update File: existing.txt
@@
 old line
-new line
+updated line
*** End Patch`

      const result = Patch.parsePatch(patchText)
      expect(result.hunks).toHaveLength(2)
      expect(result.hunks[0].type).toBe("add")
      expect(result.hunks[1].type).toBe("update")
    })

    test("should parse file move operation", () => {
      const patchText = `*** Begin Patch
*** Update File: old-name.txt
*** Move to: new-name.txt
@@
-Old content
+New content
*** End Patch`

      const result = Patch.parsePatch(patchText)
      expect(result.hunks).toHaveLength(1)
      const hunk = result.hunks[0]
      expect(hunk.type).toBe("update")
      expect(hunk.path).toBe("old-name.txt")
      if (hunk.type === "update") {
        expect(hunk.move_path).toBe("new-name.txt")
      }
    })

    test("should throw error for invalid patch format", () => {
      const invalidPatch = `This is not a valid patch`

      expect(() => Patch.parsePatch(invalidPatch)).toThrow("Invalid patch format")
    })
  })

  describe("maybeParseApplyPatch", () => {
    test("should parse direct apply_patch command", () => {
      const patchText = `*** Begin Patch
*** Add File: test.txt
+Content
*** End Patch`

      const result = Patch.maybeParseApplyPatch(["apply_patch", patchText])
      expect(result.type).toBe(Patch.MaybeApplyPatch.Body)
      if (result.type === Patch.MaybeApplyPatch.Body) {
        expect(result.args.patch).toBe(patchText)
        expect(result.args.hunks).toHaveLength(1)
      }
    })

    test("should parse applypatch command", () => {
      const patchText = `*** Begin Patch
*** Add File: test.txt
+Content
*** End Patch`

      const result = Patch.maybeParseApplyPatch(["applypatch", patchText])
      expect(result.type).toBe(Patch.MaybeApplyPatch.Body)
    })

    test("should handle bash heredoc format", () => {
      const script = `apply_patch <<'PATCH'
*** Begin Patch
*** Add File: test.txt
+Content
*** End Patch
PATCH`

      const result = Patch.maybeParseApplyPatch(["bash", "-lc", script])
      expect(result.type).toBe(Patch.MaybeApplyPatch.Body)
      if (result.type === Patch.MaybeApplyPatch.Body) {
        expect(result.args.hunks).toHaveLength(1)
      }
    })

    test("should return NotApplyPatch for non-patch commands", () => {
      const result = Patch.maybeParseApplyPatch(["echo", "hello"])
      expect(result.type).toBe(Patch.MaybeApplyPatch.NotApplyPatch)
    })
  })

  describe("applyPatch", () => {
    test("should add a new file", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const patchText = `*** Begin Patch
*** Add File: ${tmp.path}/new-file.txt
+Hello World
+This is a new file
*** End Patch`

          const result = await Patch.applyPatch(patchText)
          expect(result.added).toHaveLength(1)
          expect(result.modified).toHaveLength(0)
          expect(result.deleted).toHaveLength(0)

          const content = await fs.readFile(result.added[0], "utf-8")
          expect(content).toBe("Hello World\nThis is a new file")
        },
      })
    })

    test("should delete an existing file", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const filePath = path.join(tmp.path, "to-delete.txt")
          await fs.writeFile(filePath, "This file will be deleted")

          const patchText = `*** Begin Patch
*** Delete File: ${filePath}
*** End Patch`

          const result = await Patch.applyPatch(patchText)
          expect(result.deleted).toHaveLength(1)
          expect(result.deleted[0]).toBe(filePath)

          const exists = await fs
            .access(filePath)
            .then(() => true)
            .catch(() => false)
          expect(exists).toBe(false)
        },
      })
    })

    test("should update an existing file", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const filePath = path.join(tmp.path, "to-update.txt")
          await fs.writeFile(filePath, "line 1\nline 2\nline 3\n")

          const patchText = `*** Begin Patch
*** Update File: ${filePath}
@@
 line 1
-line 2
+updated line 2
 line 3
*** End Patch`

          const result = await Patch.applyPatch(patchText)
          expect(result.modified).toHaveLength(1)

          const content = await fs.readFile(filePath, "utf-8")
          expect(content).toBe("line 1\nupdated line 2\nline 3\n")
        },
      })
    })

    test("should move and update a file", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const oldPath = path.join(tmp.path, "old-name.txt")
          const newPath = path.join(tmp.path, "new-name.txt")
          await fs.writeFile(oldPath, "old content\n")

          const patchText = `*** Begin Patch
*** Update File: ${oldPath}
*** Move to: ${newPath}
@@
-old content
+new content
*** End Patch`

          const result = await Patch.applyPatch(patchText)
          expect(result.modified).toHaveLength(1)
          expect(result.modified[0]).toBe(newPath)

          const oldExists = await fs
            .access(oldPath)
            .then(() => true)
            .catch(() => false)
          expect(oldExists).toBe(false)

          const newContent = await fs.readFile(newPath, "utf-8")
          expect(newContent).toBe("new content\n")
        },
      })
    })

    test("should handle multiple operations in one patch", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const file1 = path.join(tmp.path, "file1.txt")
          const file2 = path.join(tmp.path, "file2.txt")
          const file3 = path.join(tmp.path, "file3.txt")

          await fs.writeFile(file1, "content 1")
          await fs.writeFile(file2, "content 2")

          const patchText = `*** Begin Patch
*** Add File: ${file3}
+new file content
*** Update File: ${file1}
@@
-content 1
+updated content 1
*** Delete File: ${file2}
*** End Patch`

          const result = await Patch.applyPatch(patchText)
          expect(result.added).toHaveLength(1)
          expect(result.added[0]).toBe(file3)

          expect(result.modified).toHaveLength(1)
          expect(result.modified[0]).toBe(file1)

          expect(result.deleted).toHaveLength(1)
          expect(result.deleted[0]).toBe(file2)

          const content1 = await fs.readFile(file1, "utf-8")
          expect(content1).toBe("updated content 1\n")

          const content3 = await fs.readFile(file3, "utf-8")
          expect(content3).toBe("new file content")

          const exists2 = await fs
            .access(file2)
            .then(() => true)
            .catch(() => false)
          expect(exists2).toBe(false)
        },
      })
    })

    test("should create parent directories when adding files", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const nestedPath = path.join(tmp.path, "deep", "nested", "file.txt")

          const patchText = `*** Begin Patch
*** Add File: ${nestedPath}
+Deep nested content
*** End Patch`

          const result = await Patch.applyPatch(patchText)
          expect(result.added).toHaveLength(1)
          expect(result.added[0]).toBe(nestedPath)

          const exists = await fs
            .access(nestedPath)
            .then(() => true)
            .catch(() => false)
          expect(exists).toBe(true)
        },
      })
    })
  })

  describe("error handling", () => {
    test("should throw error when updating non-existent file", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const nonExistent = path.join(tmp.path, "does-not-exist.txt")

          const patchText = `*** Begin Patch
*** Update File: ${nonExistent}
@@
-old line
+new line
*** End Patch`

          await expect(Patch.applyPatch(patchText)).rejects.toThrow()
        },
      })
    })

    test("should throw error when deleting non-existent file", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const nonExistent = path.join(tmp.path, "does-not-exist.txt")

          const patchText = `*** Begin Patch
*** Delete File: ${nonExistent}
*** End Patch`

          await expect(Patch.applyPatch(patchText)).rejects.toThrow()
        },
      })
    })
  })

  describe("edge cases", () => {
    test("should handle empty files", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const emptyFile = path.join(tmp.path, "empty.txt")
          await fs.writeFile(emptyFile, "")

          const patchText = `*** Begin Patch
*** Update File: ${emptyFile}
@@
+First line
*** End Patch`

          const result = await Patch.applyPatch(patchText)
          expect(result.modified).toHaveLength(1)

          const content = await fs.readFile(emptyFile, "utf-8")
          expect(content).toBe("First line\n")
        },
      })
    })

    test("should handle files with no trailing newline", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const filePath = path.join(tmp.path, "no-newline.txt")
          await fs.writeFile(filePath, "no newline")

          const patchText = `*** Begin Patch
*** Update File: ${filePath}
@@
-no newline
+has newline now
*** End Patch`

          const result = await Patch.applyPatch(patchText)
          expect(result.modified).toHaveLength(1)

          const content = await fs.readFile(filePath, "utf-8")
          expect(content).toBe("has newline now\n")
        },
      })
    })

    test("should handle multiple update chunks in single file", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const filePath = path.join(tmp.path, "multi-chunk.txt")
          await fs.writeFile(filePath, "line 1\nline 2\nline 3\nline 4\n")

          const patchText = `*** Begin Patch
*** Update File: ${filePath}
@@
 line 1
-line 2
+LINE 2
@@
 line 3
-line 4
+LINE 4
*** End Patch`

          const result = await Patch.applyPatch(patchText)
          expect(result.modified).toHaveLength(1)

          const content = await fs.readFile(filePath, "utf-8")
          expect(content).toBe("line 1\nLINE 2\nline 3\nLINE 4\n")
        },
      })
    })
  })
})
