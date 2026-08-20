import { describe, expect, test } from "bun:test"
import { ExecutionWorld } from "@/core/execution/world"

const command = { executable: "/bin/sh", args: ["-c", "pwd"], cwd: "/workspace", env: { PATH: "/usr/bin" } }

describe("ExecutionWorld", () => {
  test("keeps sandboxing off unless requested", () => {
    const prepared = ExecutionWorld.prepare(command, { workspaceRoot: "/workspace", sandbox: "off" }, [])
    expect(prepared.enforcement).toBe("off")
    expect(prepared.provider).toBe("host")
  })

  test("fails closed when required enforcement is unavailable", () => {
    expect(() =>
      ExecutionWorld.prepare(command, { workspaceRoot: "/workspace", sandbox: "require" }, []),
    ).toThrow("Sandbox was required")
  })

  test("reports the selected provider and its enforcement", () => {
    const prepared = ExecutionWorld.prepare(
      command,
      { workspaceRoot: "/workspace", sandbox: "require", network: "deny" },
      [
        {
          id: "bubblewrap",
          available: () => true,
          prepare: (input) => ({ ...input, enforcement: "full", provider: "bubblewrap" }),
        },
      ],
    )
    expect(prepared).toMatchObject({ enforcement: "full", provider: "bubblewrap" })
  })

  test("uses platform-correct shell invocation arguments", () => {
    expect(ExecutionWorld.shellArguments("/bin/bash", "echo ok")).toEqual(["-c", "echo ok"])
    expect(ExecutionWorld.shellArguments("C:\\Windows\\System32\\cmd.exe", "echo ok")).toEqual([
      "/d",
      "/s",
      "/c",
      "echo ok",
    ])
    expect(ExecutionWorld.shellArguments("pwsh.exe", "echo ok")).toEqual(["-NoProfile", "-Command", "echo ok"])
  })
})
