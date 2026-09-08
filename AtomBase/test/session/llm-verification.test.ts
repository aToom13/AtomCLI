import "../preload"
import { expect, spyOn, test } from "bun:test"
import { LLM } from "@/core/session/llm"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { Provider } from "@/integrations/provider/provider"
import { ModelVerification } from "@/integrations/provider/verification"
import { Instance } from "@/services/project/instance"
import * as AICompat from "@/util/util/ai-compat"
import { tmpdir } from "../fixture/fixture"

test("Zen conversation dispatch disables remote response references", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const provider = (await Provider.getProvider("atomcli"))!
      const model = Object.values(provider.models).find((candidate) => !candidate.id.startsWith("atomcli-"))!
      const { params } = await LLM.prepareRouteParams({
        model,
        provider,
        sessionID: "ses_zen_store",
        agent: { name: "agent", options: { store: true } } as any,
        user: { id: "msg_zen_store" } as any,
      })

      expect(params.options.store).toBe(false)
    },
  })
})

test("Free dispatch verifies missing tools and changed parameters without permitting paid probes", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const provider = (await Provider.getProvider("atomcli"))!
      const concrete = Object.values(provider.models).find(
        (model) => !model.id.startsWith("atomcli-") && Provider.isExplicitlyFree(model) && model.capabilities.toolcall,
      )!
      expect(concrete).toBeDefined()
      const model = Provider.applyRoutePolicy(concrete, {
        requested: "atomcli/atomcli-free",
        mode: "free",
        allowedProviders: ["atomcli"],
        excluded: [],
        requiredCapabilities: ["text"],
        freeOnly: true,
        requireVerification: true,
      })
      const params = {
        temperature: 0.2,
        topP: 0.8,
        topK: undefined,
        options: { verificationTest: crypto.randomUUID() },
      }
      const key = await ModelVerification.identity(concrete, provider, { effectiveParams: params })
      const attempt = await ModelVerification.begin({ key, providerID: concrete.providerID, modelID: concrete.id })
      await ModelVerification.verified(attempt, ["text"])
      const calls: any[] = []
      const generate = spyOn(AICompat, "getGenerateText").mockResolvedValue((async (request: any) => {
        calls.push(request)
        return {
          text: request.tools ? "" : "OK",
          toolCalls: request.tools ? [{ toolName: "verification", input: { value: "ok" } }] : [],
          usage: {},
        }
      }) as any)
      const language = spyOn(Provider, "getLanguage").mockResolvedValue({} as any)
      const admission = spyOn(ExecutionRuntime, "admitModelCall").mockResolvedValue(undefined)
      const prepare = spyOn(LLM, "prepareRouteParams")
      try {
        const input = { model, sessionID: "ses_dispatch_verification", abort: new AbortController().signal }
        await LLM.verifyDispatch(input, params, ["text", "tool"])
        expect(calls).toHaveLength(1)
        expect(calls[0].toolChoice).toEqual({ type: "tool", toolName: "verification" })
        expect(calls[0].temperature).toBe(0.2)
        expect(calls[0].topP).toBe(0.8)
        expect(prepare).not.toHaveBeenCalled()
        expect(ModelVerification.isVerified(await ModelVerification.get(key), "tool")).toBe(true)

        await LLM.verifyDispatch(input, params, ["text", "tool"])
        expect(calls).toHaveLength(1)
        await LLM.verifyDispatch(input, { ...params, temperature: 0.4 }, ["text", "tool"])
        expect(calls).toHaveLength(3)
        expect(calls[1].temperature).toBe(0.4)
        expect(calls[2].temperature).toBe(0.4)

        await expect(
          LLM.verifyDispatch(
            {
              ...input,
              model: { ...model, cost: { ...model.cost, input: 1 } },
            },
            params,
            ["text", "tool"],
          ),
        ).rejects.toThrow("not eligible")
        expect(calls).toHaveLength(3)

        const explicit = Provider.applyRoutePolicy(
          { ...concrete, cost: { ...concrete.cost, input: 1 } },
          {
            requested: `${concrete.providerID}/${concrete.id}`,
            mode: "explicit",
            allowedProviders: [concrete.providerID],
            excluded: [],
            requiredCapabilities: ["text", "tool"],
            freeOnly: false,
            requireVerification: true,
          },
        )
        await LLM.verifyDispatch({ ...input, model: explicit }, { ...params, temperature: 0.6 }, ["text", "tool"])
        expect(calls).toHaveLength(5)
        expect(calls.slice(3).map((call) => call.temperature)).toEqual([0.6, 0.6])
      } finally {
        prepare.mockRestore()
        admission.mockRestore()
        language.mockRestore()
        generate.mockRestore()
      }
    },
  })
})
