import { describe, expect, test } from "bun:test"
import "../../preload"
import { DialogConfirmSelection } from "@tui/ui/dialog-confirm"

describe("DialogConfirmSelection", () => {
  test("moves between cancel and confirm with arrow keys", () => {
    expect(DialogConfirmSelection.move("cancel", "right")).toBe("confirm")
    expect(DialogConfirmSelection.move("confirm", "left")).toBe("cancel")
    expect(DialogConfirmSelection.move("cancel", "down")).toBe("confirm")
    expect(DialogConfirmSelection.move("confirm", "up")).toBe("cancel")
  })

  test("keeps the safe default for unrelated keys", () => {
    expect(DialogConfirmSelection.move("cancel", "return")).toBe("cancel")
  })
})
