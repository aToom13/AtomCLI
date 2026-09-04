import "../preload"
import { expect, test } from "bun:test"
import { UpgradeCommand } from "@/interfaces/cli/cmd/upgrade"

test("update is a first-class alias for upgrade", () => {
  expect(UpgradeCommand.command).toEqual(["update [target]", "upgrade [target]"])
  expect(UpgradeCommand.describe).toContain("runtime dependencies")
})
