import "../preload"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { expect, test } from "bun:test"
import { Instance } from "@/services/project/instance"
import { planWorkflow } from "@/integrations/tool/orchestrate/plan"
import { normalizeOwnership, WorkflowOwnership } from "@/integrations/tool/orchestrate/ownership"
import { WorkflowStateStore } from "@/integrations/tool/orchestrate/state"
import { Session } from "@/core/session"
import { ExecutionRuntime } from "@/core/execution/runtime"

test("claims reject globs; native writes retain literal filename and directory boundaries", () => {
  for (const claim of ["wordCount*", "wordCount?.ts", "wordCount[12].ts"])
    expect(() => normalizeOwnership(claim, "/tmp")).toThrow("not glob patterns")
  expect(() =>
    WorkflowOwnership.assertPath({ root: "/tmp", owns: ["test-agents/wordCount*"] }, "/tmp/test-agents/word-count.ts"),
  ).toThrow("outside task ownership")
  WorkflowOwnership.assertPath({ root: "/tmp", owns: ["test-agents"] }, "/tmp/test-agents/file[1].ts")
})

test("workflow ownership uses an external session workspace when no project worktree contains it", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "atomcli-workspace-"))
  try {
    await fs.mkdir(path.join(workspace, "test-agents"))
    await Instance.provide({
      directory: os.tmpdir(),
      fn: async () => {
        expect(normalizeOwnership(path.join(workspace, "test-agents", "slugify.ts"))).toBe(
          `${path.basename(workspace)}/test-agents/slugify.ts`,
        )
        const result = await planWorkflow(
          {
            tasks: [
              {
                id: "slug",
                agent: "coder",
                prompt: "Implement slugify",
                owns: [path.join(workspace, "test-agents", "slugify.ts")],
                validationMode: "strict",
                isolation: "auto",
              },
              {
                id: "words",
                agent: "coder",
                prompt: "Implement wordCount",
                owns: [path.join(workspace, "test-agents", "word-count.ts")],
                validationMode: "strict",
                isolation: "auto",
              },
            ],
          },
          { sessionID: "workspace-ownership-test" },
          { info() {} },
        )
        expect(result.metadata.error).not.toBe(true)
        expect(result.metadata.workflowId).toBeDefined()
      },
    })
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test("ownership rejects traversal, outside paths, and symlink escapes", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "atomcli-workspace-"))
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "atomcli-outside-"))
  try {
    await fs.mkdir(path.join(workspace, "test-agents"))
    await fs.symlink(outside, path.join(workspace, "test-agents", "escape"))
    await Instance.provide({
      directory: workspace,
      fn: async () => {
        expect(() => normalizeOwnership("../outside.ts")).toThrow("outside the active workspace")
        expect(() => normalizeOwnership(path.join(outside, "outside.ts"))).toThrow("outside the active workspace")
        expect(() => normalizeOwnership("test-agents/escape/file.ts")).toThrow("through a symlink")
      },
    })
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})

test("Git sessions retain worktree-relative ownership from a nested directory", async () => {
  const { tmpdir } = await import("../fixture/fixture")
  await using project = await tmpdir({ git: true })
  await fs.mkdir(path.join(project.path, "nested"))
  await Instance.provide({
    directory: path.join(project.path, "nested"),
    fn: async () => {
      expect(normalizeOwnership("root.ts")).toBe("root.ts")
      expect(normalizeOwnership(path.join(project.path, "root.ts"))).toBe("root.ts")
      expect(() => normalizeOwnership("../escape.ts")).toThrow("outside the active workspace")
    },
  })
})

test.each([false, true])("required isolation is validated during planning: Git=%s", async (git) => {
  const { tmpdir } = await import("../fixture/fixture")
  await using workspace = await tmpdir({ git })
  await Instance.provide({
    directory: workspace.path,
    fn: async () => {
      const session = await Session.create({})
      const before = WorkflowStateStore.keys()
      const result = await planWorkflow(
        {
          tasks: [
            {
              id: "required",
              agent: "coder",
              prompt: "Inspect owned file",
              owns: ["file.ts"],
              validationMode: "strict",
              isolation: "required",
            },
          ],
        },
        { sessionID: session.id },
        { info() {} },
      )
      if (git) {
        expect(result.metadata.error, result.output).toBe(false)
        expect(WorkflowStateStore.get(result.metadata.workflowId!)!.tasks[0].isolation).toBe("required")
      } else {
        expect(result.metadata.error).toBe(true)
        expect(result.output).toContain("not a git worktree")
        expect(result.metadata.workflowId).toBeUndefined()
        expect(WorkflowStateStore.keys()).toEqual(before)
      }
      expect(await Session.children(session.id)).toHaveLength(0)
      expect(ExecutionRuntime.snapshot(session.id).blockers).toHaveLength(0)
    },
  })
})

test("canonical aliases cannot give parallel tasks ownership of the same file", async () => {
  const { tmpdir } = await import("../fixture/fixture")
  await using workspace = await tmpdir()
  await Bun.write(path.join(workspace.path, "target.ts"), "fake fixture")
  await fs.symlink("target.ts", path.join(workspace.path, "alias.ts"))
  await Instance.provide({
    directory: workspace.path,
    fn: async () => {
      const result = await planWorkflow(
        {
          tasks: ["target.ts", "alias.ts"].map((file, index) => ({
            id: `task-${index}`,
            agent: "coder",
            prompt: "Inspect file",
            owns: [file],
            validationMode: "strict",
            isolation: "auto",
          })),
        },
        { sessionID: "ses_canonical_ownership" },
        { info() {} },
      )
      expect(result.metadata.error).toBe(true)
      expect(result.output).toContain("overlapping ownership")
      expect(result.metadata.workflowId).toBeUndefined()
    },
  })
})
