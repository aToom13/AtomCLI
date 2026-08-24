import "./preload"
import { describe, expect, test } from "bun:test"
import { SessionLayout } from "@tui/routes/session/layout"
import { runningAgentsForStep, type ActiveSubAgent } from "@tui/context/subagent"

describe("SubAgentPanel", () => {
  describe("vertical density", () => {
    test("compacts session chrome before short terminals run out of room", () => {
      expect(SessionLayout.verticalMode(17)).toBe("tight")
      expect(SessionLayout.verticalMode(18)).toBe("compact")
      expect(SessionLayout.verticalMode(29)).toBe("compact")
      expect(SessionLayout.verticalMode(30)).toBe("normal")
    })

    test("fits an expanded task plan to its content on short terminals", () => {
      expect(SessionLayout.chainExpandedHeight(22, 1)).toBe(2)
      expect(SessionLayout.chainExpandedHeight(22, 20)).toBe(6)
      expect(SessionLayout.chainExpandedHeight(35, 1)).toBe(7)
      expect(SessionLayout.chainExpandedHeight(35, 5)).toBe(8)
    })

    test("uses the scrollbox viewport instead of placing its scrollbar below the task list", () => {
      const compactHeight = SessionLayout.chainExpandedHeight(26, 5)
      expect(compactHeight).toBe(6)
      expect(SessionLayout.chainListViewportRows(26, compactHeight)).toBe(5)
      expect(SessionLayout.chainNeedsScrollbar(26, compactHeight, 5)).toBe(false)
      expect(SessionLayout.chainNeedsScrollbar(22, SessionLayout.chainExpandedHeight(22, 20), 20)).toBe(true)
      expect(SessionLayout.chainScrollContentOptions).toEqual({ flexDirection: "column" })
    })

    test("caps long task plans at five rows and centers the active task", () => {
      const expandedHeight = SessionLayout.chainExpandedHeight(35, 14)
      expect(expandedHeight).toBe(8)
      expect(SessionLayout.chainListViewportRows(35, expandedHeight)).toBe(5)
      expect(SessionLayout.chainNeedsScrollbar(35, expandedHeight, 14)).toBe(true)

      const rows = Array.from({ length: 14 }, () => 1)
      expect(SessionLayout.chainCenteredScrollOffset(rows, 0, 5)).toBe(0)
      expect(SessionLayout.chainCenteredScrollOffset(rows, 2, 5)).toBe(0)
      expect(SessionLayout.chainCenteredScrollOffset(rows, 7, 5)).toBe(5)
      expect(SessionLayout.chainCenteredScrollOffset(rows, 13, 5)).toBe(9)
    })

    test("reserves task-row badges before truncating long names", () => {
      expect(SessionLayout.chainStepNameWidth(59, 0)).toBe(48)
      expect(SessionLayout.chainStepNameWidth(59, 1, 7)).toBe(41)
      expect(SessionLayout.chainStepNameWidth(24, 99, 20)).toBe(8)
    })

    test("does not duplicate generated task numbering", () => {
      expect(SessionLayout.chainStepLabel("1. Ortam ve bağımlılık kontrolü")).toBe("Ortam ve bağımlılık kontrolü")
      expect(SessionLayout.chainStepLabel("2) Test dosyalarının taranması")).toBe("Test dosyalarının taranması")
      expect(SessionLayout.chainStepLabel("v1.2 release hazırlığı")).toBe("v1.2 release hazırlığı")
    })

    test("renders stable marquee frames from the beginning through the end", () => {
      const value = "Temel gezinme ve snapshot doğrulaması"
      expect(SessionLayout.marqueeWindow(value, 12, 0)).toBe("Temel gezin…")
      expect(SessionLayout.marqueeWindow(value, 12, 5)).toBe("… gezinme v…")
      expect(SessionLayout.marqueeWindow(value, 12, 999)).toBe("…doğrulaması")
      expect(SessionLayout.marqueeWindow("Kısa görev", 12, 4)).toBe("Kısa görev")
    })

    test("formats live agent runtime without negative elapsed values", () => {
      expect(SessionLayout.elapsedLabel(1_000, 66_000)).toBe("01:05")
      expect(SessionLayout.elapsedLabel(1_000, 3_662_000)).toBe("1:01:01")
      expect(SessionLayout.elapsedLabel(2_000, 1_000)).toBe("00:00")
    })
  })

  describe("responsive panel width", () => {
    test("does not render a side panel if it would crush the chat", () => {
      expect(SessionLayout.agentPanelWidth(50, 3, true)).toBe(0)
      expect(SessionLayout.agentPanelWidth(60, 18, true)).toBe(0)
    })

    test("uses the available space instead of an independent fixed width", () => {
      expect(SessionLayout.agentPanelWidth(89, 3, true)).toBe(22)
      expect(SessionLayout.agentPanelWidth(90, 36, true)).toBe(18)
      expect(SessionLayout.agentPanelWidth(120, 3, true)).toBe(36)
    })

    test("keeps the computed chat width above the readable minimum", () => {
      for (const width of [40, 60, 80, 100, 140, 200]) {
        const files = SessionLayout.fileTreeWidth(width, width >= 60)
        const agents = SessionLayout.agentPanelWidth(width, files, true)
        const chat = SessionLayout.chatWidth(width, files, agents)
        expect(chat).toBeGreaterThanOrEqual(SessionLayout.MIN_CHAT_WIDTH)
        expect(files + agents + chat + 4).toBeLessThanOrEqual(width)
      }
    })

    test("keeps an overlay inspector inside extremely small terminals", () => {
      expect(SessionLayout.inspectorWidth(20, true, false)).toBe(18)
      expect(SessionLayout.inspectorWidth(40, true, false)).toBe(30)
    })
  })

  describe("taskflow agent association", () => {
    const agents: ActiveSubAgent[] = [
      {
        sessionId: "ses-explore",
        parentSessionId: "ses-parent",
        parentStepId: "spawn-test",
        agentType: "explore",
        description: "Inspect agent architecture",
        status: "running",
      },
      {
        sessionId: "ses-other-step",
        parentSessionId: "ses-parent",
        parentStepId: "workflow-test",
        agentType: "checker",
        description: "Check results",
        status: "running",
      },
      {
        sessionId: "ses-other-parent",
        parentSessionId: "ses-unrelated",
        parentStepId: "spawn-test",
        agentType: "coder",
        description: "Unrelated work",
        status: "running",
      },
    ]

    test("shows only the running agent attached to the selected parent step", () => {
      expect(runningAgentsForStep(agents, "spawn-test", true, "ses-parent").map((agent) => agent.sessionId)).toEqual([
        "ses-explore",
      ])
    })

    test("uses unassociated recovered agents only for the current step", () => {
      const recovered: ActiveSubAgent[] = [
        {
          sessionId: "ses-legacy",
          parentSessionId: "ses-parent",
          agentType: "explore",
          description: "Recovered task",
          status: "running",
        },
      ]
      expect(runningAgentsForStep(recovered, "current", true, "ses-parent")).toHaveLength(1)
      expect(runningAgentsForStep(recovered, "other", false, "ses-parent")).toHaveLength(0)
    })
  })
})
