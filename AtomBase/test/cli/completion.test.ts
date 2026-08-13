import { describe, expect, test } from "bun:test"
import { ShellCompletion } from "@/interfaces/cli/cmd/completion"

describe("shell completion", () => {
  test("detects supported shells", () => {
    expect(ShellCompletion.detect({ shell: "/bin/bash", platform: "linux" })).toBe("bash")
    expect(ShellCompletion.detect({ shell: "/usr/bin/zsh", platform: "darwin" })).toBe("zsh")
    expect(ShellCompletion.detect({ shell: "/usr/bin/fish", platform: "linux" })).toBe("fish")
    expect(ShellCompletion.detect({ platform: "win32" })).toBe("powershell")
  })

  test("generates dynamic completion for every supported shell", () => {
    for (const shell of ["bash", "zsh", "fish", "powershell"] as const) {
      const script = ShellCompletion.script(shell)
      expect(script).toContain("atomcli --get-yargs-completions")
      expect(script).not.toContain("ATOMCLI_DISABLE_DAEMON")
    }
    expect(ShellCompletion.script("bash")).toContain("complete -o bashdefault")
    expect(ShellCompletion.script("zsh")).toContain("compdef _atomcli_completion atomcli")
    expect(ShellCompletion.script("fish")).toContain("complete -c atomcli")
    expect(ShellCompletion.script("powershell")).toContain("Parameters.ContainsKey('Native')")
  })

  test("removes internal command names from suggestions", () => {
    expect(ShellCompletion.clean(["$0", "auth", "auth", "__completion"])).toEqual(["auth"])
  })
})
