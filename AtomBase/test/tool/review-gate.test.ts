import "../preload"
import { describe, expect, test } from "bun:test"
import { HarnessState } from "@/core/session/harness-state"
import { buildReviewPrompt, collectDescendantIds } from "@/integrations/tool/review-gate"
import { Instance } from "@/services/project/instance"
import { Session } from "@/core/session"
import { Identifier } from "@/core/id/id"
import { tmpdir } from "../fixture/fixture"

describe("ReviewGate - buildReviewPrompt", () => {
  test("includes original request, edited files, and review checklist", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-gate-prompt-1"
        HarnessState.addEditedFile(sessionID, "src/a.ts")
        HarnessState.addEditedFile(sessionID, "src/b.ts")

        const prompt = await buildReviewPrompt(sessionID)

        expect(prompt).toContain("<original_user_request>")
        expect(prompt).toContain("</original_user_request>")
        expect(prompt).toContain("<edited_files>")
        expect(prompt).toContain("src/a.ts")
        expect(prompt).toContain("src/b.ts")
        expect(prompt).toContain('verdict "rejected"')
        expect(prompt).toContain('"passed" or "inconclusive"')
        expect(prompt).toContain("git diff")
        expect(prompt).toContain("Security scan")
      },
    })
  })

  test("handles session with no edited files", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-gate-prompt-none"
        const prompt = await buildReviewPrompt(sessionID)
        expect(prompt).toContain("<none>")
        expect(prompt).toContain("structured output schema")
      },
    })
  })

  test("escapes XML-significant characters in file paths (prompt-injection defense)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-gate-prompt-escape"
        HarnessState.addEditedFile(sessionID, "src/<injected>.ts")

        const prompt = await buildReviewPrompt(sessionID)

        // The raw breakout tag must not appear unescaped inside <file>...</file>
        expect(prompt).toContain("&lt;injected&gt;")
        expect(prompt).not.toContain("<file>src/<injected>.ts</file>")
      },
    })
  })

  test("reviews the current user turn instead of the first request in session history", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        for (const text of ["old request", "current request"]) {
          const message = await Session.updateMessage({
            id: Identifier.ascending("message"),
            sessionID: session.id,
            role: "user",
            time: { created: Date.now() },
            agent: "build",
            model: { providerID: "fixture", modelID: "fixture" },
          })
          await Session.updatePart({
            id: Identifier.ascending("part"),
            messageID: message.id,
            sessionID: session.id,
            type: "text",
            text,
          })
        }

        const prompt = await buildReviewPrompt(session.id)
        expect(prompt).toContain("current request")
        expect(prompt).not.toContain("old request")
      },
    })
  })
})

describe("ReviewGate - collectDescendantIds", () => {
  test("terminates on cycles via the visited set (no infinite recursion)", async () => {
    // a -> b -> a cycle would hang a naive recursive walk
    const provider = async (id: string) => {
      if (id === "a") return [{ id: "b" } as any]
      if (id === "b") return [{ id: "a" } as any]
      return []
    }
    const ids = await collectDescendantIds("a", provider)
    expect(ids).toEqual(["b"])
  })

  test("enforces the depth cap (no deep-chain blowup)", async () => {
    let calls = 0
    const provider = async (id: string) => {
      calls++
      if (calls >= 40) return []
      return [{ id: `node-${calls}` } as any]
    }
    const ids = await collectDescendantIds("root", provider)
    // MAX_DESCENDANT_DEPTH = 32
    expect(ids.length).toBeLessThanOrEqual(32)
  })

  test("enforces the session cap (no O(N²) wide-graph blowup)", async () => {
    const wide = Array.from({ length: 600 }, (_, i) => ({ id: `leaf-${i}` }) as any)
    const provider = async (id: string) => (id === "root" ? wide : [])
    const ids = await collectDescendantIds("root", provider)
    // MAX_DESCENDANT_SESSIONS = 500
    expect(ids.length).toBe(500)
  })
})
