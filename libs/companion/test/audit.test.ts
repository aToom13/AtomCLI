import { afterEach, describe, expect, test } from "bun:test"
import { appendFileSync, chmodSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CompanionAudit } from "../src/audit"

const originalTestHome = process.env.ATOMCLI_TEST_HOME

afterEach(() => {
  if (originalTestHome === undefined) delete process.env.ATOMCLI_TEST_HOME
  else process.env.ATOMCLI_TEST_HOME = originalTestHome
})

describe("CompanionAudit", () => {
  test("stores bounded metadata without action content", () => {
    const directory = mkdtempSync(join(tmpdir(), "atomcli-audit-"))
    process.env.ATOMCLI_TEST_HOME = directory

    CompanionAudit.record({
      action: "permission_resolve",
      outcome: "error",
      deviceId: "phone-1",
      deviceName: "Galaxy",
      errorCode: "/home/user/private/token.txt was rejected",
      timestamp: 42,
    })

    expect(CompanionAudit.recent(1)).toEqual([
      {
        action: "permission_resolve",
        outcome: "error",
        deviceId: "phone-1",
        deviceName: "Galaxy",
        errorCode: "operation_failed",
        timestamp: 42,
      },
    ])
    const raw = readFileSync(join(directory, ".atomcli", "companion-audit.jsonl"), "utf8")
    expect(raw).not.toContain("private/token")
    expect(raw).not.toContain("text")
    appendFileSync(join(directory, ".atomcli", "companion-audit.jsonl"), "not-json\n")
    expect(CompanionAudit.recent()).toContainEqual(
      expect.objectContaining({ action: "permission_resolve", timestamp: 42 }),
    )

    // Ensure an unreadable/corrupt destination cannot change control behavior.
    chmodSync(join(directory, ".atomcli", "companion-audit.jsonl"), 0o400)
    expect(() => CompanionAudit.record({ action: "unpair", outcome: "ok", deviceId: "phone-1" })).not.toThrow()
  })
})
