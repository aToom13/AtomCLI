import "../preload"
import { expect, spyOn, test } from "bun:test"
import { Provider } from "@/integrations/provider/provider"
import { ModelFallback } from "@/integrations/provider/fallback"
import { Auth } from "@/services/auth"
import { Instance } from "@/services/project/instance"
import * as AICompat from "@/util/util/ai-compat"
import { tmpdir } from "../fixture/fixture"

test("OAuth verification streams text and tool evidence without unsupported output limits; API keys keep completion probes", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const original = (await Provider.getProvider("atomcli"))!
      const base = Object.values(original.models).find((model) => model.capabilities.toolcall)!
      const model = { ...base, providerID: "openai", id: "fixture-codex" }
      const spies: Array<{ mockRestore(): void }> = []
      const params = {
        options: { instructions: "fixture instructions", store: false },
        temperature: undefined,
        topP: undefined,
        topK: undefined,
      }
      const streamed: any[] = []
      const completed: any[] = []
      const answer = (request: any) => ({
        text: request.tools ? "" : "OK",
        toolCalls: request.tools ? [{ toolName: "verification", input: { value: "ok" } }] : [],
        usage: {},
        finishReason: request.tools ? "tool-calls" : "stop",
      })
      try {
        spies.push(spyOn(Provider, "getModel").mockResolvedValue(model))
        spies.push(spyOn(Provider, "getProvider").mockResolvedValue({ ...original, id: "openai" }))
        spies.push(spyOn(Provider, "getLanguage").mockResolvedValue({} as any))
        const auth = spyOn(Auth, "get").mockResolvedValue({
          type: "oauth",
          access: "fake-access",
          refresh: "fake-refresh",
          expires: Date.now() + 60_000,
        })
        spies.push(auth)
        spies.push(
          spyOn(AICompat, "getStreamText").mockResolvedValue(((request: any) => {
            streamed.push(request)
            const result = answer(request)
            return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, Promise.resolve(value)]))
          }) as any),
        )
        spies.push(
          spyOn(AICompat, "getGenerateText").mockResolvedValue((async (request: any) => {
            completed.push(request)
            return answer(request)
          }) as any),
        )
        for (const capability of ["text", "tool"] as const) {
          const [result] = await ModelFallback.probeModels(["openai/fixture-codex"], {
            capability,
            effectiveParams: params,
            force: true,
          })
          expect(result.available).toBe(true)
        }
        expect(completed).toHaveLength(0)
        expect(streamed).toHaveLength(2)
        for (const request of streamed) {
          expect(request.maxOutputTokens).toBeUndefined()
          expect(request.providerOptions.openai).toMatchObject(params.options)
        }
        expect(streamed[1].toolChoice).toEqual({ type: "tool", toolName: "verification" })
        await ModelFallback.probeModels(["openai/fixture-codex"], { capability: "text", force: true })
        expect(streamed[2].providerOptions.openai.instructions).toBeString()
        expect(streamed[2].providerOptions.openai.store).toBe(false)
        auth.mockResolvedValue({ type: "api", key: "fake-api-key" })
        const [result] = await ModelFallback.probeModels(["openai/fixture-codex"], {
          capability: "text",
          effectiveParams: params,
          force: true,
        })
        expect(result.available).toBe(true)
        expect(completed).toHaveLength(1)
        expect(completed[0].maxOutputTokens).toBe(256)
      } finally {
        for (const spy of spies.reverse()) spy.mockRestore()
      }
    },
  })
})
