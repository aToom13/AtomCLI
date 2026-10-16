import "../../preload"
import { expect, test } from "bun:test"

test.skipIf(process.platform !== "linux").each([false, true])(
  "real TUI accepts prompt, resizes, exits with terminal state: stalled=%s",
  async (stalled) => {
    const process = Bun.spawn(
      ["python3", `${import.meta.dir}/pty-smoke.py`, "--type-prompt", ...(stalled ? ["--stall-provider"] : [])],
      { stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr, exit] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ])
    expect(exit, stdout + stderr).toBe(0)
    const summary = JSON.parse(stdout.trim().split("\n").at(-1)!)
    expect(summary.scripted_provider).toBe(true)
    expect(summary.typed_prompt).toBe(true)
    expect(summary.bytes).toBeGreaterThan(1000)
  },
  30_000,
)

test.skipIf(process.platform !== "linux")(
  "real TUI resumes the same session and submits another turn",
  async () => {
    const process = Bun.spawn(["python3", `${import.meta.dir}/pty-smoke.py`, "--type-prompt", "--resume-check"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exit] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ])
    expect(exit, stdout + stderr).toBe(0)
    expect(JSON.parse(stdout.trim().split("\n").at(-1)!).resumed_turns).toBe(2)
  },
  50_000,
)

test.skipIf(process.platform !== "linux")(
  "real TUI navigation, long native output, errors and returned input",
  async () => {
    const process = Bun.spawn(
      ["python3", `${import.meta.dir}/pty-smoke.py`, "--type-prompt", "--matrix", "--seconds", "21"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [stdout, stderr, exit] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ])
    expect(exit, stdout + stderr).toBe(0)
    const summary = JSON.parse(stdout.trim().split("\n").at(-1)!)
    expect(summary.executions).toHaveLength(2)
    expect(summary.peak_rss_kib).toBeGreaterThan(0)
  },
  // Driver bounds: 15s startup + 21s exercise + 8s exit, plus process cleanup.
  50_000,
)
