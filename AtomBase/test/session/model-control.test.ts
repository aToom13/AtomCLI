import "../preload"
import { expect, spyOn, test } from "bun:test"
import { SessionPrompt } from "@/core/session/prompt"
import { Session } from "@/core/session"
import { SessionProcessor } from "@/core/session/processor"
import { LLM } from "@/core/session/llm"
import { Identifier } from "@/core/id/id"
import { AgentEval } from "@/core/eval/harness"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { ModelControl } from "@/integrations/tool/model-control"
import { Provider } from "@/integrations/provider/provider"
import { Bus } from "@/core/bus"
import { Instance } from "@/services/project/instance"
import { Question } from "@/interfaces/question"
import { tmpdir } from "../fixture/fixture"

for (const decision of ["accept", "accept_free", "reject", "verification_failure", "params_changed"] as const) {
  test(`model control: ${decision} crosses the real prompt-loop boundary`, async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Model control test" })
        const provider = (await Provider.getProvider("atomcli"))!
        const base = Object.values(provider.models).find(
          (m) => !m.id.startsWith("atomcli-") && m.capabilities.toolcall,
        )!
        expect(base).toBeDefined()
        const target = { ...base, providerID: "fixture-provider", id: "fixture-luna", name: "Fixture Luna" }
        const accepting = decision === "accept" || decision === "accept_free"
        const requested =
          decision === "accept_free"
            ? { providerID: "atomcli", modelID: "atomcli-free" }
            : { providerID: target.providerID, modelID: target.id }
        const user = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          agent: "build",
          model: { providerID: base.providerID, modelID: base.id },
          time: { created: Date.now() },
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: user.id,
          type: "text",
          text: "Selam",
        })
        const spies: Array<{ mockRestore(): void }> = []
        const calls: string[] = []
        let proposalID = ""
        let decisionTask: Promise<void> | undefined
        const unsubscribeProposal = Bus.subscribe(ExecutionRuntime.Event.RouteProposal, ({ properties }) => {
          if (properties.sessionID !== session.id || properties.proposal.state !== "pending") return
          proposalID = properties.proposal.id
        })
        const unsubscribeQuestion = Bus.subscribe(Question.Event.Asked, ({ properties }) => {
          if (properties.sessionID !== session.id) return
          // A delayed click reproduces the original race: no old-model call may pass it.
          decisionTask = (async () => {
            await Bun.sleep(30)
            expect(calls).toEqual([base.id])
            await Question.reply({
              requestID: properties.id,
              answers: [[decision === "reject" ? "Keep current" : "Switch once"]],
            })
          })()
        })
        try {
          spies.push(spyOn(AgentEval, "executionPolicy").mockReturnValue({ allowAuxiliarySummaries: false } as any))
          spies.push(
            spyOn(Provider, "getModel").mockImplementation(async (_provider, model) =>
              model === target.id || model === "atomcli-free" ? target : base,
            ),
          )
          spies.push(spyOn(Provider, "getProvider").mockImplementation(async (id) => ({ ...provider, id })))
          let preparations = 0
          spies.push(
            spyOn(LLM, "prepareRouteParams").mockImplementation(
              async () =>
                ({
                  params: { options: {}, temperature: decision === "params_changed" && preparations++ > 0 ? 0.4 : 0.2 },
                }) as any,
            ),
          )
          const verify = spyOn(LLM, "verifyDispatch").mockImplementation(async () => {
            expect(
              ExecutionRuntime.routeProposalHistory(`${session.id}:${user.id}`).find((p) => p.id === proposalID)?.state,
            ).toBe("accepted")
            if (decision === "verification_failure") throw new Error("fixture verification refused")
          })
          spies.push(verify)
          spies.push(spyOn(Provider, "isRouteEligible").mockResolvedValue(true))
          spies.push(
            spyOn(SessionProcessor, "create").mockImplementation(
              (input) =>
                ({
                  message: input.assistantMessage,
                  partFromToolCall: () => undefined,
                  async process(stream) {
                    calls.push(stream.model.id)
                    expect(stream.tools.model_control).toBeDefined()
                    if (calls.length === 1) {
                      await stream.tools.model_control.execute!(
                        {
                          action: "request",
                          ...requested,
                          reason: "The user requested Luna",
                          scope: "model",
                        },
                        { toolCallId: "route-request", messages: [], abortSignal: stream.abort },
                      )
                      input.assistantMessage.finish = "stop" // Providers may report stop even after a tool call.
                      return { status: "continue" }
                    }
                    expect(calls.length).toBe(2)
                    if (accepting) expect(Provider.routePolicy(stream.model).requireVerification).toBe(true)
                    if (decision === "accept_free")
                      expect(Provider.routePolicy(stream.model)).toMatchObject({
                        mode: "free",
                        freeOnly: true,
                        requested: "atomcli/atomcli-free",
                        allowedProviders: [target.providerID],
                      })
                    return { status: "stop" }
                  },
                }) as any,
            ),
          )
          await SessionPrompt.loop(session.id)
          await decisionTask
          const proposal = ExecutionRuntime.routeProposalHistory(`${session.id}:${user.id}`).find(
            (p) => p.id === proposalID,
          )!
          expect(proposal.scope).toBe("model")
          if (accepting) {
            expect(calls).toEqual([base.id, target.id])
            expect(proposal.state).toBe("applied")
            expect(await SessionPrompt._internals.lastModel(session.id)).toEqual(requested)
            expect(ExecutionRuntime.view(proposal.executionID)?.route?.base.modelID).toBe(target.id)
          } else {
            expect(proposal.state).not.toBe("applied")
            expect(calls).toEqual(decision === "reject" ? [base.id, base.id] : [base.id])
            if (decision === "reject" || decision === "params_changed") expect(verify).not.toHaveBeenCalled()
          }
        } finally {
          unsubscribeProposal()
          unsubscribeQuestion()
          for (const spy of spies.reverse()) spy.mockRestore()
        }
      },
    })
  }, 20_000)
}

test("model control validates requests and cannot be used by child sessions", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const root = await Session.create({})
      const child = await Session.create({ parentID: root.id })
      const tool = await ModelControl.Info.init()
      const context = {
        sessionID: root.id,
        messageID: "msg_fixture",
        agent: "build",
        abort: new AbortController().signal,
        metadata() {},
        async ask() {},
      }
      await expect(tool.execute({ action: "request" }, context)).rejects.toThrow("requires providerID")
      await expect(tool.execute({ action: "list" }, { ...context, sessionID: child.id })).rejects.toThrow(
        "main conversation",
      )
    },
  })
})

test("route approval waiting handles expiry, cancellation and decisions made before subscribing", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const user = await Session.updateMessage({
        id: Identifier.ascending("message"),
        sessionID: session.id,
        role: "user",
        agent: "build",
        model: { providerID: "fixture", modelID: "base" },
        time: { created: Date.now() },
      })
      const execution = await ExecutionRuntime.resolveInvocation({
        sessionID: session.id,
        invocationID: user.id,
        kind: "root",
        acceptedMessageID: user.id,
      })
      for (const behavior of ["expiry", "cancel", "early_accept"] as const) {
        const result = await ExecutionRuntime.proposeRoute({
          id: crypto.randomUUID(),
          sessionID: session.id,
          execution,
          executionID: execution.executionID,
          invocationID: execution.invocationID,
          stepID: user.id,
          expectedRouteRevision: 1,
          fromRoute: { providerID: "fixture", modelID: "base" },
          toRoute: { providerID: "fixture", modelID: "target" },
          paramsDigest: "fixture-params",
          credentialRevision: "fixture-credentials",
          scope: "model",
          reasonCode: "test",
          evidenceRefs: [],
          expiresAt: Date.now() + (behavior === "expiry" ? 30 : 10_000),
          policyVersion: 1,
        })
        expect(result.proposed).toBe(true)
        if (!result.proposed) throw new Error(result.reason)
        const abort = new AbortController()
        if (behavior === "early_accept") {
          expect(
            ExecutionRuntime.decideRouteProposal({
              sessionID: session.id,
              projectID: session.projectID,
              executionID: execution.executionID,
              proposalID: result.proposal.id,
              requestID: crypto.randomUUID(),
              expectedProposalVersion: result.proposal.version,
              expectedRouteRevision: 1,
              decision: "accept",
              actorID: "fixture-user",
            }).decided,
          ).toBe(true)
        }
        const waiting = ExecutionRuntime.waitForRouteDecision(session.id, execution, abort.signal)
        if (behavior === "cancel") {
          abort.abort(new Error("fixture cancellation"))
          await expect(waiting).rejects.toThrow("fixture cancellation")
        } else {
          await waiting
          expect(
            ExecutionRuntime.routeProposalHistory(execution.executionID).find((p) => p.id === result.proposal.id)
              ?.state,
          ).toBe(behavior === "expiry" ? "expired" : "accepted")
        }
      }
    },
  })
})
