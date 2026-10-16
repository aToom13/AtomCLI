import "../preload"
import { expect, spyOn, test } from "bun:test"
import { SessionCompaction } from "@/core/session/compaction"
import { SessionProcessor } from "@/core/session/processor"
import { Session } from "@/core/session"
import { MessageV2 } from "@/core/session/message-v2"
import { Identifier } from "@/core/id/id"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { Provider } from "@/integrations/provider/provider"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Skill } from "@/integrations/skill"

test("committed compaction retains load history and durable objective when model summary omits both", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const provider = (await Provider.getProvider("atomcli"))!
      const model = Object.values(provider.models).find(
        (item) => !item.id.startsWith("atomcli-") && item.capabilities.toolcall,
      )!
      const user = (await Session.updateMessage({
        id: Identifier.ascending("message"),
        sessionID: session.id,
        role: "user",
        agent: "agent",
        model: { providerID: model.providerID, modelID: model.id },
        time: { created: Date.now() },
      })) as MessageV2.User
      const objective = "Build two playable 3D games in one readable HTML file; verify movement, scoring and reset."
      const trustedRead = Skill.loadedChunk(
        "game-development",
        "/skills/game-development/SKILL.md",
        "x".repeat(500),
        0,
        100,
      )
      await Session.updatePart({
        id: Identifier.ascending("part"),
        sessionID: session.id,
        messageID: user.id,
        type: "text",
        text: objective + "\n" + "Earlier observations and tool output. ".repeat(1_000),
        metadata: {
          skillReads: [trustedRead],
          skillManifest: [
            "Skill: game-development; source: /skills/game-development/SKILL.md",
            "Loaded parent game-development: characters 0–100 of 500",
            "- game-development/references/3d-rendering.md, offset=500: partial; context limit",
          ].join("\n"),
        },
      })
      const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: user.id })
      ExecutionRuntime.recordObjective(execution.executionID, user.id, objective)
      const getModel = spyOn(Provider, "getModel").mockResolvedValue(model)
      const processor = spyOn(SessionProcessor, "create").mockImplementation(
        (input) =>
          ({
            message: input.assistantMessage,
            async process(stream) {
              const prompt = JSON.stringify(stream.messages.at(-1))
              expect(prompt).toContain("exact acceptance criteria")
              expect(prompt).toContain("checkpoint decision and trigger reason")
              await Session.updatePart({
                id: Identifier.ascending("part"),
                sessionID: session.id,
                messageID: input.assistantMessage.id,
                type: "text",
                text: "## Completed work\nBuild prepared.\n## Remaining work\nBehavior verification.\n## Files\nindex.html",
              })
              await Session.updateMessage({
                ...input.assistantMessage,
                finish: "stop",
                time: { ...input.assistantMessage.time, completed: Date.now() },
              })
              return { status: "continue" }
            },
          }) as never,
      )
      try {
        expect(
          await SessionCompaction.process({
            parentID: user.id,
            messages: await Session.messages({ sessionID: session.id }),
            sessionID: session.id,
            abort: new AbortController().signal,
            auto: true,
          }),
        ).toBe("continue")
        const compacted = await MessageV2.filterCompacted(MessageV2.stream(session.id))
        const summary = compacted.find((message) => message.info.role === "assistant" && message.info.summary)!
        const history = summary.parts.find(
          (part) => part.type === "text" && part.metadata?.skillManifest,
        ) as MessageV2.TextPart
        expect(history.text).toContain("source: /skills/game-development/SKILL.md")
        expect(history.text).toContain("characters 0–100 of 500")
        expect(history.text).toContain("offset=500")
        expect(history.metadata?.skillReads).toEqual([trustedRead])
        expect(Skill.loadedChunks(compacted)).toContainEqual(trustedRead)
        expect(ExecutionRuntime.objective(execution.executionID)?.objective).toBe(objective)
        expect(SessionCompaction._internals.skillManifest(compacted)).toContain("offset=500")
      } finally {
        processor.mockRestore()
        getModel.mockRestore()
        ExecutionRuntime.cancelExecution(execution)
      }
    },
  })
})
