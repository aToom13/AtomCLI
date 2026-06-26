import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { WorkflowFS } from "@/integrations/tool/workflow-fs"
import fs from "fs/promises"
import path from "path"
import os from "os"

const TEST_WF_ID = "wf_test_unit_000000"
const tmpRoot = path.join(os.tmpdir(), `atomcli-wf-test-${process.pid}`)
let testDir: string

describe("WorkflowFS", () => {
  beforeAll(async () => {
    // Use a temp dir as root so we don't need Instance.worktree
    WorkflowFS.setRootDir(tmpRoot)
    await fs.mkdir(tmpRoot, { recursive: true })

    // Ensure clean state
    testDir = WorkflowFS.getRunDir(TEST_WF_ID)
    await fs.rm(testDir, { recursive: true, force: true })
  })

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
    WorkflowFS.resetRootDir()
  })

  describe("getRunDir", () => {
    test("returns absolute path under .atomcli/runs/", () => {
      const dir = WorkflowFS.getRunDir(TEST_WF_ID)
      expect(dir).toContain(".atomcli/runs/")
      expect(dir).toContain(TEST_WF_ID)
      expect(path.isAbsolute(dir)).toBe(true)
    })
  })

  describe("ensureRunDir", () => {
    test("creates the directory recursively", async () => {
      const dir = await WorkflowFS.ensureRunDir(TEST_WF_ID)
      const stat = await fs.stat(dir)
      expect(stat.isDirectory()).toBe(true)
    })

    test("is idempotent — does not throw on second call", async () => {
      const dir = await WorkflowFS.ensureRunDir(TEST_WF_ID)
      const dir2 = await WorkflowFS.ensureRunDir(TEST_WF_ID)
      expect(dir).toBe(dir2)
    })
  })

  describe("writeSuccess", () => {
    test("writes a success markdown file", async () => {
      const filePath = await WorkflowFS.writeSuccess(TEST_WF_ID, "task1", "coder", "Hello World")
      expect(filePath).toContain("task1_coder_success.md")
      const content = await Bun.file(filePath).text()
      expect(content).toContain("✅ Success")
      expect(content).toContain("Hello World")
      expect(content).toContain("Task: task1 (@coder)")
      expect(content).toContain("Completed At:")
    })
  })

  describe("writeFailed", () => {
    test("writes a failure markdown file", async () => {
      const filePath = await WorkflowFS.writeFailed(TEST_WF_ID, "task2", "explore", "Something broke")
      expect(filePath).toContain("task2_explore_failed.md")
      const content = await Bun.file(filePath).text()
      expect(content).toContain("❌ Failed")
      expect(content).toContain("Something broke")
      expect(content).toContain("Task: task2 (@explore)")
    })

    test("includes attempt count when provided", async () => {
      const filePath = await WorkflowFS.writeFailed(TEST_WF_ID, "task3", "general", "Timeout", 3)
      const content = await Bun.file(filePath).text()
      expect(content).toContain("**Attempts:** 3")
    })

    test("includes originalOutput when provided", async () => {
      const original = "Bu çok değerli bir analiz raporudur.\n\nDetaylı inceleme tamamlandı."
      const filePath = await WorkflowFS.writeFailed(
        TEST_WF_ID,
        "task4",
        "analyst",
        "QA_FAILED: Eksik kaynakça",
        2,
        original,
      )
      expect(filePath).toContain("task4_analyst_failed.md")
      const content = await Bun.file(filePath).text()
      expect(content).toContain("## Original Output")
      expect(content).toContain("Bu çok değerli bir analiz raporudur.")
      expect(content).toContain("Detaylı inceleme tamamlandı.")
      expect(content).toContain("## Error")
      expect(content).toContain("QA_FAILED: Eksik kaynakça")
      expect(content).toContain("**Attempts:** 2")
    })
  })

  describe("exists", () => {
    test("returns true when run directory exists", async () => {
      expect(await WorkflowFS.exists(TEST_WF_ID)).toBe(true)
    })

    test("returns false when run directory does not exist", async () => {
      expect(await WorkflowFS.exists("wf_nonexistent_000000")).toBe(false)
    })
  })

  describe("listFiles", () => {
    test("lists all .md files in the run directory", async () => {
      const files = await WorkflowFS.listFiles(TEST_WF_ID)
      expect(files.length).toBeGreaterThanOrEqual(4)
      expect(files.some((f) => f.endsWith("task1_coder_success.md"))).toBe(true)
      expect(files.some((f) => f.endsWith("task2_explore_failed.md"))).toBe(true)
      expect(files.some((f) => f.endsWith("task3_general_failed.md"))).toBe(true)
      expect(files.some((f) => f.endsWith("task4_analyst_failed.md"))).toBe(true)
    })

    test("returns empty array when directory does not exist", async () => {
      const files = await WorkflowFS.listFiles("wf_nonexistent_000000")
      expect(files).toEqual([])
    })
  })
})
