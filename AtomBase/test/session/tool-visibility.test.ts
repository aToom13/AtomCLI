import "../preload"
import { expect, test } from "bun:test"
import { filterTurnTools } from "@/core/session/prompt/tools"

test("turn restrictions intersect without restoring tools excluded by policy or permissions", () => {
  const tools = { read: {}, grep: {}, edit: {}, skill: {} }
  expect(Object.keys(filterTurnTools(tools, { expert: true, pendingSkills: true }))).toEqual(["read", "grep"])
  expect(Object.keys(filterTurnTools(tools, { pendingSkills: true }))).toEqual(["read", "grep", "skill"])
  expect(filterTurnTools(tools, { checkpointRequired: true })).toEqual({})
  expect(tools.edit).toBeDefined()
})
