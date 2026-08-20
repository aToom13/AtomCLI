import { describe, expect, test } from "bun:test"
import path from "node:path"
import { UI } from "@/interfaces/cli/ui"

const repositoryRoot = path.resolve(import.meta.dir, "../../..")

async function readRepositoryFile(relativePath: string) {
  return Bun.file(path.join(repositoryRoot, relativePath)).text()
}

function shellBanner(source: string) {
  return source
    .split("\n")
    .map((line) => line.match(/^\s*echo "([^"]*[█╗╝║][^"]*)"$/)?.[1])
    .filter((line): line is string => line !== undefined)
}

function powershellBanner(source: string) {
  return source
    .split("\n")
    .map((line) => line.match(/^\s*Write-Host "([^"]*[█╗╝║][^"]*)" -ForegroundColor Cyan$/)?.[1])
    .filter((line): line is string => line !== undefined)
}

describe("AtomCLI branding", () => {
  test("renders the canonical six-line logo", () => {
    expect(UI.Logo.lines).toHaveLength(6)
    expect(UI.Logo.lines.every((line) => line.length > 0)).toBe(true)
    expect(UI.Logo.width).toBe(Math.max(...UI.Logo.lines.map((line) => line.length)))
    expect(
      UI.logo()
        .replaceAll(/\x1b\[[0-9;]*m|\x1b\[38;5;[\x00-\x7f]*m/g, "")
        .split("\n"),
    ).toEqual(UI.Logo.lines)
  })

  test("keeps installer banners synchronized with the canonical logo", async () => {
    const [shell, powershell] = await Promise.all([readRepositoryFile("install.sh"), readRepositoryFile("install.ps1")])

    expect(shellBanner(shell)).toEqual(UI.Logo.lines)
    expect(powershellBanner(powershell)).toEqual(UI.Logo.lines)
  })

  test("uses the canonical logo in the main documentation", async () => {
    const readme = await readRepositoryFile("README.md")
    expect(readme).toContain(["```text", ...UI.Logo.lines, "```"].join("\n"))
  })
})
