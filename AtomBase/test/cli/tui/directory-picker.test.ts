import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { directoryEntries, normalizeDirectory, validateDirectory } from "@/interfaces/cli/cmd/tui/component/directory-picker"

describe("directory picker", () => {
  test("normalizes home shorthand and clamps parent navigation at home", () => {
    const home = os.homedir()
    expect(normalizeDirectory("~")).toBe(home)
    expect(directoryEntries(home, home).some((entry) => entry === path.dirname(home))).toBe(false)
  })

  test("rejects files and accepts existing directories", () => {
    expect(validateDirectory(os.homedir())).toBe(path.resolve(os.homedir()))
    expect(() => validateDirectory(path.join(os.homedir(), "__atomcli_missing_directory__"))).toThrow("Directory not found")
  })
})
