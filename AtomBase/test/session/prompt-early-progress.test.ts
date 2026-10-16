import { expect, test } from "bun:test"
import "../preload"
import { SessionPrompt } from "@/core/session/prompt"

test("focused work requests an early useful result after bounded exploration", () => {
  expect(
    SessionPrompt._internals.earlyProgressReminder({
      scope: "focused",
      step: 2,
      toolCalls: 3,
      successfulToolCalls: 3,
      mutatingCalls: 0,
    }),
  ).toContain("first useful result")
  expect(
    SessionPrompt._internals.earlyProgressReminder({
      scope: "direct",
      step: 2,
      toolCalls: 3,
      successfulToolCalls: 3,
      mutatingCalls: 0,
    }),
  ).toBeUndefined()
})
