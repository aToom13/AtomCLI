import { describe, expect, test } from "bun:test"
import { SessionReuse } from "@/integrations/tool/session-reuse"

describe("SessionReuse.isAllowed — session reuse parentID guard", () => {
  test("allows a session whose parentID matches the caller", () => {
    expect(SessionReuse.isAllowed({ id: "ses_child", parentID: "parent_mine" }, "parent_mine")).toBe(true)
  })

  test("rejects a session owned by a different parent", () => {
    expect(SessionReuse.isAllowed({ id: "ses_foreign", parentID: "parent_other" }, "parent_mine")).toBe(false)
  })

  test("rejects a session with no parentID when the caller has one", () => {
    expect(SessionReuse.isAllowed({ id: "ses_root" }, "parent_mine")).toBe(false)
  })

  test("rejects null and undefined sessions", () => {
    expect(SessionReuse.isAllowed(null, "parent_mine")).toBe(false)
    expect(SessionReuse.isAllowed(undefined, "parent_mine")).toBe(false)
  })
})
