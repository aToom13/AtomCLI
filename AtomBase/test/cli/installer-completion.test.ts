import { describe, expect, test } from "bun:test"
import path from "path"

const root = path.resolve(import.meta.dir, "../../..")

describe("completion installation", () => {
  test("Unix installer generates and activates completion", async () => {
    const script = await Bun.file(path.join(root, "install.sh")).text()
    expect(script).toContain("setup_completion()")
    expect(script).toContain('completion "$shell_name"')
    expect(script).toContain(".config/fish/completions/atomcli.fish")
    expect(script).toContain("# AtomCLI tab completion")
    expect(script.match(/\bsetup_completion\b/g)?.length).toBeGreaterThan(3)
  })

  test("PowerShell installer generates and activates completion", async () => {
    const script = await Bun.file(path.join(root, "install.ps1")).text()
    expect(script).toContain("function Install-Completion")
    expect(script).toContain("& $binary completion powershell")
    expect(script).toContain("$PROFILE.CurrentUserAllHosts")
    expect(script).toContain("Install-Completion")
  })

  test("README documents manual activation for every shell", async () => {
    const readme = await Bun.file(path.join(root, "README.md")).text()
    for (const shell of ["bash", "zsh", "fish", "powershell"]) {
      expect(readme).toContain(`atomcli completion ${shell}`)
    }
  })
})
