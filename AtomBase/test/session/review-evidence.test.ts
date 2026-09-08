import { describe, expect, test } from "bun:test"
import "../preload"
import { SessionPrompt } from "@/core/session/prompt"

const user = (created: number, synthetic = false) => ({
  info: { role: "user", time: { created } },
  parts: [{ type: "text", text: "request", synthetic }],
})

const patch = (created: number, files: string[]) => ({
  info: { role: "assistant", time: { created } },
  parts: [{ type: "patch", files }],
})

describe("SessionPrompt review evidence", () => {
  test("restores patches only from the current real user turn", () => {
    const messages = [
      user(1),
      patch(2, ["src/old.ts"]),
      user(3),
      patch(4, ["src/current.ts"]),
      user(5, true),
      patch(6, ["src/retry.ts"]),
    ] as any

    expect(SessionPrompt.reviewEvidenceFiles(messages)).toEqual(["src/current.ts", "src/retry.ts"])
    expect(SessionPrompt.reviewEvidenceFiles(messages, 4)).toEqual([])
  })
})
