import { expect, test } from "bun:test"
import "../preload"
import { SubAgent } from "@/integrations/tool/subagent"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

test("execution timeout cancels only the child and fences late completion", async () => {
  if (typeof SubAgent.register !== "function") {
    // Other tool tests replace this module process-wide; keep the real runtime check isolated.
    const child = Bun.spawn([process.execPath, "test", import.meta.filename], { stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (exitCode !== 0) throw new Error(`${stdout}\n${stderr}`)
    return
  }
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      let cancelled = 0
      let release!: () => void
      let announce!: () => void
      const started = new Promise<void>((resolve) => {
        announce = resolve
      })
      let complete!: () => void
      const finished = new Promise<void>((resolve) => {
        complete = resolve
      })
      SubAgent.register({
        id: "test-timeout",
        capabilities: {
          outputSchema: false,
          persona: true,
          toolFilter: true,
          depthLimit: true,
          continuation: true,
          cancellation: true,
          isolation: false,
          wait: true,
          steer: false,
          revive: true,
          status: true,
          liveActivity: false,
        },
        async spawn(config) {
          await config.onSession?.({ sessionId: "ses_timeout_child", isNewSession: true })
          announce()
          await new Promise<void>((resolve) => {
            release = resolve
          })
          complete()
          return { sessionId: "ses_timeout_child", isNewSession: true, output: "late", parts: [] }
        },
        cancel() {
          cancelled++
        },
      })
      const controller = new AbortController()
      const config = {
        runtime: "test-timeout",
        parentSessionID: "ses_timeout_root",
        agent: { name: "coder" } as never,
        model: { providerID: "test", modelID: "test" },
        parts: [],
        permissions: [],
        description: "timeout",
        signal: controller.signal,
        executionTimeoutMs: 5,
      }
      const pending = SubAgent.spawn(config)
      const rejected = expect(pending).rejects.toThrow("Sub-agent execution timed out")
      await started
      const waiting = SubAgent.wait("ses_timeout_child", { timeoutMs: 1000 })
      await rejected
      expect((await waiting).status).toBe("timed_out")
      expect(controller.signal.aborted).toBe(false)
      await expect(SubAgent.spawn({ ...config, sessionId: "ses_timeout_child" })).rejects.toThrow("still draining")
      release()
      await finished
      await Promise.resolve()
      expect(cancelled).toBe(1)
      expect(SubAgent.status("ses_timeout_child").status).toBe("timed_out")
    },
  })
})
