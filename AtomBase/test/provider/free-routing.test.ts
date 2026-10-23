import "../preload"
import { expect, spyOn, test } from "bun:test"
import { Session } from "@/core/session"
import { Identifier } from "@/core/id/id"
import { ModelPurpose } from "@/core/routing/model-purpose"
import { Provider } from "@/integrations/provider/provider"
import { TaskDispatch } from "@/integrations/tool/task-dispatch"
import { SubAgent } from "@/integrations/tool/subagent"
import { selectModel } from "@/integrations/tool/model-router"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

test("Free persists through helper and child dispatch; a later explicit selection can leave it", async () => {
  await using tmp = await tmpdir({ config: { experimental: { smart_model_routing: true } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const free = { providerID: "atomcli", modelID: "atomcli-free" }
      const outside = { providerID: "outside", modelID: "paid-model" }
      const getModel = spyOn(Provider, "getModel").mockResolvedValue({
        providerID: "atomcli",
        id: "fake-concrete",
      } as any)
      const getLanguage = spyOn(Provider, "getLanguage").mockResolvedValue({} as any)
      const spawn = spyOn(SubAgent, "spawn").mockResolvedValue({
        sessionId: "ses_fake_child",
        isNewSession: true,
        output: "OK",
        parts: [],
      })
      const permissions = [{ permission: "task", pattern: "*", action: "deny" as const }]
      try {
        expect(await selectModel("analysis", free)).toEqual(free)
        for (const reference of [free, outside]) {
          await Session.updateMessage({
            id: Identifier.ascending("message"),
            sessionID: session.id,
            role: "user",
            time: { created: Date.now() },
            agent: "build",
            model: reference,
          })
          await ModelPurpose.resolve("analysis", "Summarize project context", outside, session.id)
          expect(getModel.mock.calls.at(-1)?.slice(0, 2)).toEqual([reference.providerID, reference.modelID])
          await TaskDispatch.spawn({
            parentSessionID: session.id,
            agent: { name: "explore" },
            model: outside,
            parts: [],
            permissions,
            description: "Inspect project",
          } as any)
          expect(spawn.mock.calls.at(-1)?.[0].model).toEqual(reference)
          expect(spawn.mock.calls.at(-1)?.[0].permissions).toEqual(permissions)
        }
      } finally {
        spawn.mockRestore()
        getLanguage.mockRestore()
        getModel.mockRestore()
      }
    },
  })
})
