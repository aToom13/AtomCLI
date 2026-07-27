import { describe, expect, test } from "bun:test"
import { computePanelWidth } from "@tui/routes/session/components/SubAgentPanel"

describe("SubAgentPanel", () => {
  describe("computePanelWidth", () => {
    test("returns 25 for terminal width < 90 (e.g. 0, 50, 79, 89)", () => {
      expect(computePanelWidth(0)).toBe(25)
      expect(computePanelWidth(50)).toBe(25)
      expect(computePanelWidth(79)).toBe(25)
      expect(computePanelWidth(89)).toBe(25)
    })

    test("returns 30 for terminal width in [90, 120) (e.g. 90, 100, 119)", () => {
      expect(computePanelWidth(90)).toBe(30)
      expect(computePanelWidth(100)).toBe(30)
      expect(computePanelWidth(119)).toBe(30)
    })

    test("returns 40 for terminal width in [120, 150) (e.g. 120, 135, 149)", () => {
      expect(computePanelWidth(120)).toBe(40)
      expect(computePanelWidth(135)).toBe(40)
      expect(computePanelWidth(149)).toBe(40)
    })

    test("returns 50 for terminal width in [150, 180) (e.g. 150, 165, 179)", () => {
      expect(computePanelWidth(150)).toBe(50)
      expect(computePanelWidth(165)).toBe(50)
      expect(computePanelWidth(179)).toBe(50)
    })

    test("returns 58 for terminal width >= 180 (e.g. 180, 200, 300)", () => {
      expect(computePanelWidth(180)).toBe(58)
      expect(computePanelWidth(200)).toBe(58)
      expect(computePanelWidth(300)).toBe(58)
    })

    test("verifies exact boundary transitions between adjacent ranges", () => {
      // 89 vs 90
      expect(computePanelWidth(89)).toBe(25)
      expect(computePanelWidth(90)).toBe(30)

      // 119 vs 120
      expect(computePanelWidth(119)).toBe(30)
      expect(computePanelWidth(120)).toBe(40)

      // 149 vs 150
      expect(computePanelWidth(149)).toBe(40)
      expect(computePanelWidth(150)).toBe(50)

      // 179 vs 180
      expect(computePanelWidth(179)).toBe(50)
      expect(computePanelWidth(180)).toBe(58)
    })
  })
})
