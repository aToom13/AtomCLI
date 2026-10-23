import "../preload"
import { describe, expect, test } from "bun:test"
import { ExecutionWorld } from "@/core/execution/world"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"

const command = { executable: "/bin/sh", args: ["-c", "pwd"], cwd: "/workspace", env: { PATH: "/usr/bin" } }

describe("ExecutionWorld", () => {
  test("private paths cannot silently run on the host", () => {
    expect(() =>
      ExecutionWorld.prepare(command, { workspaceRoot: "/workspace", hiddenPaths: ["/private"] }, []),
    ).toThrow("Hidden execution paths require")
  })

  test.skipIf(process.platform !== "linux" || !Bun.which("bwrap"))(
    "OS sandbox hides evaluator files from shell code and keeps workspace writes",
    async () => {
      await using tmp = await tmpdir()
      const workspace = path.join(tmp.path, "workspace")
      const hidden = path.join(tmp.path, "private")
      await fs.mkdir(workspace)
      await fs.mkdir(hidden)
      await Bun.write(path.join(hidden, "answer"), "private-test-marker")
      await fs.symlink(hidden, path.join(workspace, "linked-private"))
      const prepared = ExecutionWorld.prepare(
        {
          executable: "/bin/bash",
          args: [
            "-ec",
            'test ! -e "$PRIVATE/answer"; test ! -e linked-private/answer; test ! -e /proc/$PARENT/root$PRIVATE/answer; echo ok > result; mktemp >/dev/null',
          ],
          cwd: workspace,
          env: { PATH: process.env.PATH!, PRIVATE: hidden, PARENT: String(process.pid) },
        },
        { workspaceRoot: workspace, sandbox: "require", hiddenPaths: [hidden] },
      )
      const proc = Bun.spawn([prepared.executable, ...prepared.args], {
        cwd: prepared.cwd,
        env: prepared.env,
        stdout: "pipe",
        stderr: "pipe",
      })
      const [code, error] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
      expect(code, error).toBe(0)
      expect(await Bun.file(path.join(workspace, "result")).text()).toBe("ok\n")
      expect(await Bun.file(path.join(hidden, "answer")).text()).toBe("private-test-marker")
    },
  )
  test("keeps sandboxing off unless requested", () => {
    const prepared = ExecutionWorld.prepare(command, { workspaceRoot: "/workspace", sandbox: "off" }, [])
    expect(prepared.enforcement).toBe("off")
    expect(prepared.provider).toBe("host")
  })

  test("fails closed when required enforcement is unavailable", () => {
    expect(() => ExecutionWorld.prepare(command, { workspaceRoot: "/workspace", sandbox: "require" }, [])).toThrow(
      "Sandbox was required",
    )
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
    expect(ExecutionWorld.shellArguments("/bin/bash", "echo ok")).toEqual(["-e", "-o", "pipefail", "-c", "echo ok"])
    expect(ExecutionWorld.shellArguments("C:\\Windows\\System32\\cmd.exe", "echo ok")).toEqual([
      "/d",
      "/s",
      "/c",
      "echo ok",
    ])
    expect(ExecutionWorld.shellArguments("pwsh.exe", "echo ok")).toEqual(["-NoProfile", "-Command", "echo ok"])
  })
})
