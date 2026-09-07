import "../../preload"
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { DialogConfirmKeyboard } from "@tui/ui/dialog-confirm"

describe("DialogConfirm keyboard renderer", () => {
  test("moves visible selection with arrows, focuses it, and confirms it with Enter", async () => {
    const focused: string[] = []
    let confirmed = 0
    let cancelled = 0

    function Subject() {
      return (
        <DialogConfirmKeyboard
          title="Exit AtomCLI?"
          message="Are you sure?"
          onFocus={(value) => focused.push(value)}
          onConfirm={() => confirmed++}
          onCancel={() => cancelled++}
        >
          {(selected) => <text>selected:{selected()}</text>}
        </DialogConfirmKeyboard>
      )
    }

    const setup = await testRender(Subject, { width: 40, height: 4 })
    try {
      await setup.renderOnce()
      expect(setup.captureCharFrame()).toContain("selected:cancel")
      expect(focused).toEqual(["cancel"])

      setup.mockInput.pressArrow("right")
      await setup.renderOnce()
      expect(setup.captureCharFrame()).toContain("selected:confirm")
      expect(focused).toEqual(["cancel", "confirm"])

      setup.mockInput.pressEnter()
      await setup.renderOnce()
      expect(confirmed).toBe(1)
      expect(cancelled).toBe(0)
    } finally {
      setup.renderer.destroy()
    }
  })
})
