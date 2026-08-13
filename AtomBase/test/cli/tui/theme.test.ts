import { describe, expect, test } from "bun:test"
import { SystemTheme } from "@/interfaces/cli/cmd/tui/context/theme"

describe("system theme", () => {
  test("is always listed first with a user-facing name", () => {
    expect(SystemTheme.title).toBe("Default System")
    expect(SystemTheme.options(["zenburn", "system", "aura"])).toEqual(["system", "aura", "zenburn"])
  })

  test("detects appearance from the terminal background", () => {
    expect(SystemTheme.mode("#111827")).toBe("dark")
    expect(SystemTheme.mode("#f8fafc")).toBe("light")
  })

  test("keeps the generated system theme reserved", () => {
    expect(SystemTheme.withoutReserved({ system: "custom", aura: "theme" })).toEqual({ aura: "theme" })
  })
})
