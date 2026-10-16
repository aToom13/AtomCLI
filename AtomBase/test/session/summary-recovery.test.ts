import { describe, expect, test } from "bun:test"
import { SessionSummary } from "@/core/session/summary"
import { Session } from "@/core/session"
import { Storage } from "@/core/storage/storage"
import { Identifier } from "@/core/id/id"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

async function addUserMessage(sessionID: string, text: string) {
  const messageID = Identifier.ascending("message")
  await Session.updateMessage({
    id: messageID,
    sessionID,
    role: "user",
    agent: "build",
    model: { providerID: "test", modelID: "fixture" },
    time: { created: Date.now() },
  })
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID,
    sessionID,
    type: "text",
    text,
  })
  return messageID
}

describe("session summary recovery (HIST-04)", () => {
  test("persists a durable intent when a summary is scheduled", async () => {
    await using project = await tmpdir()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const session = await Session.create({})
        const messageID = await addUserMessage(session.id, "durable intent")

        await SessionSummary.summarize({ sessionID: session.id, messageID })

        const intent = await Storage.read<{ sessionID: string; messageID: string; enqueuedAt: number }>([
          "session_summary_intent",
          session.id,
        ])
        expect(intent).toMatchObject({ sessionID: session.id, messageID })
        expect(intent.enqueuedAt).toBeGreaterThan(0)

        SessionSummary.cancelPendingSummarize(session.id)
        await Storage.remove(["session_summary_intent", session.id])
      },
    })
  })

  test("reschedules durable intents after a restart and clears them on completion", async () => {
    await using project = await tmpdir()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const session = await Session.create({})
        const messageID = await addUserMessage(session.id, "recover my summary")
        // summarizeMessage needs the assistant reply to derive the title.
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "assistant",
          parentID: messageID,
          agent: "build",
          path: { cwd: project.path, root: project.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "fixture",
          providerID: "test",
          time: { created: Date.now() },
        })

        // Simulate a crash: the durable intent exists but its in-memory
        // debounce timer was lost with the process.
        await Storage.write(["session_summary_intent", session.id], {
          sessionID: session.id,
          messageID,
          enqueuedAt: Date.now(),
        })
        expect(await SessionSummary.recoverPending({ delayMs: 30 })).toBeGreaterThanOrEqual(1)

        // The recovered intent runs the normal summarize path exactly once and
        // removes itself afterwards.
        await new Promise((resolve) => setTimeout(resolve, 400))
        expect(await Storage.read(["session_summary_intent", session.id]).catch(() => undefined)).toBeUndefined()
        const messages = await Session.messages({ sessionID: session.id, excludePatches: true })
        const recovered = messages.find((message) => message.info.id === messageID)
        expect(recovered?.info.role).toBe("user")
        expect(recovered?.info.role === "user" ? recovered.info.summary?.title : undefined).toBe("recover my summary")
      },
    })
  })
})
