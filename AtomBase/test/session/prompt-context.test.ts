import { describe, expect, spyOn, test } from "bun:test"
import "../preload"
import { SessionPrompt } from "@/core/session/prompt"
import { Session } from "@/core/session"
import { MessageV2 } from "@/core/session/message-v2"
import { Identifier } from "@/core/id/id"
import { Instance } from "@/services/project/instance"
import { Config } from "@/core/config/config"
import { Storage } from "@/core/storage/storage"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { tmpdir } from "../fixture/fixture"

describe("session prompt turn context", () => {
  test("bounds shell output while preserving the newest complete text", () => {
    const limit = 96
    let output = SessionPrompt._internals.appendShellOutput("", "old:" + "x".repeat(120), limit)
    output = SessionPrompt._internals.appendShellOutput(output, "\nnewest-result", limit)

    expect(new TextEncoder().encode(output).byteLength).toBeLessThanOrEqual(limit)
    expect(output).toStartWith("[earlier shell output truncated]\n")
    expect(output).toEndWith("newest-result")
    expect(output.match(/earlier shell output truncated/g)).toHaveLength(1)
  })

  test("persists a model-resolution failure once as the selected virtual model's assistant error", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const user = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "agent",
          model: { providerID: "atomcli", modelID: "atomcli-free" },
        })) as MessageV2.User
        const first = await SessionPrompt._internals.recordModelResolutionError({
          sessionID: session.id,
          user,
          messages: await Session.messages({ sessionID: session.id }),
          error: new Error("atomcli-free: no verified free model is currently available"),
        })
        const second = await SessionPrompt._internals.recordModelResolutionError({
          sessionID: session.id,
          user,
          messages: await Session.messages({ sessionID: session.id }),
          error: new Error("must not create a duplicate"),
        })
        const messages = await Session.messages({ sessionID: session.id })
        const failures = messages.filter(
          (message) => message.info.role === "assistant" && message.info.parentID === user.id,
        )

        expect(second.id).toBe(first.id)
        expect(failures).toHaveLength(1)
        expect(first.providerID).toBe("atomcli")
        expect(first.modelID).toBe("atomcli-free")
        expect(first.finish).toBeUndefined()
        expect(first.time.completed).toBeUndefined()
        expect(first.error?.data.message).toContain("no verified free model")
      },
    })
  })

  test("disables the actual tool set on the final step", () => {
    expect(SessionPrompt._internals.shouldResolveTools(false)).toBe(true)
    expect(SessionPrompt._internals.shouldResolveTools(true)).toBe(false)
  })

  test("distinguishes synthetic execution continuations from real user turns", () => {
    const base = {
      id: "message-continuation",
      sessionID: "session-continuation",
      role: "user" as const,
      time: { created: Date.now() },
      agent: "build",
      model: { providerID: "test", modelID: "fixture" },
    }
    expect(
      SessionPrompt._internals.isSyntheticContinuation({
        info: base,
        parts: [
          {
            id: "part-synthetic",
            messageID: base.id,
            sessionID: base.sessionID,
            type: "text",
            text: "retry",
            synthetic: true,
          },
        ],
      }),
    ).toBe(true)
    expect(
      SessionPrompt._internals.isSyntheticContinuation({
        info: { ...base, id: "message-real" },
        parts: [
          {
            id: "part-real",
            messageID: "message-real",
            sessionID: base.sessionID,
            type: "text",
            text: "a real follow-up",
          },
        ],
      }),
    ).toBe(false)
  })

  test("a cancellation response does not answer later user messages", () => {
    const user = { id: "msg_080e_new" } as MessageV2.User
    const cancelled = { id: "msg_cancel_old", parentID: "msg_080d_old", finish: "error" } as MessageV2.Assistant
    const current = { id: "msg_080e_reply", parentID: user.id, finish: "stop" } as MessageV2.Assistant

    expect(SessionPrompt._internals.isFinishedResponse(user, cancelled)).toBe(false)
    expect(SessionPrompt._internals.isFinishedResponse(user, current)).toBe(true)
  })

  test("an old run cleanup cannot cancel its replacement", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "ses_run_owner"
        const first = SessionPrompt._internals.start(sessionID)!
        SessionPrompt.cancel(sessionID)
        const replacement = SessionPrompt._internals.start(sessionID)!

        SessionPrompt._internals.finish(sessionID, first)

        expect(replacement.signal.aborted).toBe(false)
        expect(() => SessionPrompt.assertNotBusy(sessionID)).toThrow()
        SessionPrompt.cancel(sessionID)
      },
    })
  })

  test("normal run cleanup does not abort the completed run", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "ses_completed_owner"
        const owner = SessionPrompt._internals.start(sessionID)!

        SessionPrompt._internals.finish(sessionID, owner)

        expect(owner.signal.aborted).toBe(false)
        expect(() => SessionPrompt.assertNotBusy(sessionID)).not.toThrow()
      },
    })
  })

  test("puts the max-step instruction in system context without ending on an assistant turn", () => {
    const messages = [{ role: "user" as const, content: "Continue the task" }]
    const result = SessionPrompt._internals.prepareTurnContext(["base"], messages, true)

    expect(result.system).toHaveLength(2)
    expect(result.system[1]).toContain("MAXIMUM STEPS REACHED")
    expect(result.messages).toEqual(messages)
    expect(result.messages.at(-1)?.role).toBe("user")
  })

  test("does not alter normal turn context", () => {
    const system = ["base"]
    const messages = [{ role: "assistant" as const, content: "history" }]
    const result = SessionPrompt._internals.prepareTurnContext(system, messages, false)

    expect(result.system).toBe(system)
    expect(result.messages).toBe(messages)
  })

  test("omits tool schemas only for exact casual turns", () => {
    const decide = (prompt: string) =>
      SessionPrompt._internals.shouldLoadTools({
        prompt,
        explicitTools: false,
        bypassAgentCheck: false,
        hasPriorToolActivity: false,
      })

    expect(decide("Selam")).toBe(false)
    expect(decide("Naber?")).toBe(false)
    expect(decide("HI")).toBe(false)
    expect(decide("Add an endpoint")).toBe(true)
    expect(decide("Yeni bir endpoint ekle")).toBe(true)
    expect(decide("Find why the app is slow")).toBe(true)
    expect(decide("Devam et")).toBe(true)
  })

  test("preserves tools for explicit agents, tool overrides, and continuing tool sessions", () => {
    const decide = (overrides: Partial<Parameters<typeof SessionPrompt._internals.shouldLoadTools>[0]>) =>
      SessionPrompt._internals.shouldLoadTools({
        prompt: "Selam",
        explicitTools: false,
        bypassAgentCheck: false,
        hasPriorToolActivity: false,
        ...overrides,
      })

    expect(decide({ explicitTools: true })).toBe(true)
    expect(decide({ bypassAgentCheck: true })).toBe(true)
    expect(decide({ prompt: "Continue", hasPriorToolActivity: true })).toBe(true)
  })

  test("builds deterministic review retry and blocked messages without exposing a candidate", () => {
    const retry = SessionPrompt._internals.reviewRetryText("src/a.ts must be fixed")
    const blocked = SessionPrompt._internals.reviewBlockedText("Reviewer unavailable")

    expect(retry).toContain("final response was withheld")
    expect(retry).toContain("src/a.ts must be fixed")
    expect(blocked).toContain("Completion is blocked")
    expect(blocked).toContain("Reviewer unavailable")
  })

  test("projects an already identical completion without rewriting parts or finish", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const messageID = Identifier.ascending("message")
        const partID = Identifier.ascending("part")
        const completed = Date.now()
        await Session.updateMessage({
          id: messageID,
          role: "assistant",
          parentID: Identifier.ascending("message"),
          sessionID: session.id,
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "fixture",
          providerID: "test",
          time: { created: completed, completed },
          finish: "stop",
        })
        const part = {
          id: partID,
          messageID,
          sessionID: session.id,
          type: "text" as const,
          text: "committed response",
        }
        await Session.updatePart(part)
        const updatePart = spyOn(Session, "updatePartGuarded")
        const updateMessage = spyOn(Session, "updateMessageGuarded")
        try {
          await SessionPrompt._internals.projectCompletion({
            executionID: "execution-projected",
            sessionID: session.id,
            messageID,
            ownerID: "owner",
            fence: 1,
            finish: "stop",
            parts: [part],
            editedFiles: [],
            digest: "digest",
            requiresReview: false,
            revision: 0,
            planRevision: 0,
            routeRevision: 1,
            policyVersion: 1,
            policyDigest: "policy",
            reviewRequirement: "not_required",
            reviewReasonCode: "no_mutations",
            requiredReviewers: 0,
            attemptLimit: 3,
            contentSnapshotDigest: "snapshot",
            projection: "projected",
            state: "committed",
            projectorID: "projector",
            projectionToken: "token",
            projectionLeaseExpiresAt: Date.now() + 10_000,
            sessionGeneration: 1,
          })
          expect(updatePart).not.toHaveBeenCalled()
          expect(updateMessage).not.toHaveBeenCalled()
        } finally {
          updatePart.mockRestore()
          updateMessage.mockRestore()
        }
      },
    })
  })

  test("abandons recovery projection when a durable session tombstone already exists", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await Storage.tombstoneSessions([session.id])
        const result = await SessionPrompt._internals.projectAndAckCompletion({
          executionID: "execution-deleted-session",
          sessionID: session.id,
          messageID: Identifier.ascending("message"),
          ownerID: "owner",
          fence: 1,
          finish: "stop",
          parts: [],
          editedFiles: [],
          digest: "deleted-session-digest",
          requiresReview: false,
          revision: 0,
          planRevision: 0,
          routeRevision: 1,
          policyVersion: 1,
          policyDigest: "policy",
          reviewRequirement: "not_required",
          reviewReasonCode: "no_mutations",
          requiredReviewers: 0,
          attemptLimit: 3,
          contentSnapshotDigest: "snapshot",
          projection: "pending",
          state: "committed",
        })
        expect(result).toBe("abandoned")
        expect(await Storage.sessionGuard(session.id)).toMatchObject({ tombstone: true, generation: 2 })
      },
    })
  })

  test("projects a root cancellation outbox even when no assistant message exists yet", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const userID = Identifier.ascending("message")
        await Session.updateMessage({
          id: userID,
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test", modelID: "fixture" },
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: userID,
          sessionID: session.id,
          type: "text",
          text: "cancel before the provider responds",
        })
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: userID })
        const view = ExecutionRuntime.view(execution.executionID)!
        expect(
          ExecutionRuntime.requestCancel({
            requestID: "cancel-before-assistant",
            executionID: execution.executionID,
            sessionID: session.id,
            projectID: Instance.project.id,
            expectedVersion: view.version,
          }),
        ).toMatchObject({ accepted: true })

        const claim = ExecutionRuntime.claimCompletion(session.id, execution.executionID)
        expect(claim).toBeDefined()
        expect(await SessionPrompt._internals.projectAndAckCompletion(claim!)).toBe("projected")
        const messages = await Session.messages({ sessionID: session.id, excludePatches: false })
        const assistant = messages.find((message) => message.info.id === claim!.messageID)
        expect(assistant?.info).toMatchObject({ role: "assistant", parentID: userID, finish: "error" })
        expect(assistant?.parts).toEqual([
          expect.objectContaining({ type: "text", text: "This execution was cancelled." }),
        ])
        expect(ExecutionRuntime.view(execution.executionID)?.completion?.projection).toBe("projected")
      },
    })
  })

  test("records durable recovery when a committed completion has no projectable message", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const userID = Identifier.ascending("message")
        await Session.updateMessage({
          id: userID,
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test", modelID: "fixture" },
        })
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: userID })
        const staged = await ExecutionRuntime.stageCompletion({
          sessionID: session.id,
          messageID: Identifier.ascending("message"),
          finish: "stop",
          parts: [],
          editedFiles: [],
          requiresReview: false,
          execution,
        })
        const committed = await ExecutionRuntime.commitCompletion({
          sessionID: session.id,
          execution,
          digest: staged.digest,
        })

        expect(await SessionPrompt._internals.projectAndAckCompletion(committed)).toBe("recovery_required")
        expect(ExecutionRuntime.view(execution.executionID)).toMatchObject({
          recoveryRequired: true,
          completion: { projection: "recovery_required" },
        })
        expect(ExecutionRuntime.claimCompletion(session.id, execution.executionID)).toBeUndefined()
      },
    })
  })

  test("recovers from a model removed since the session was created", async () => {
    await Config.clearCache()
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "default",
          model: { providerID: "atomcli", modelID: "removed-free-model" },
          time: { created: Date.now() },
        })

        const selected = await SessionPrompt._internals.lastModel(session.id)
        expect(selected).not.toEqual({ providerID: "atomcli", modelID: "removed-free-model" })
      },
    })
  })
})
