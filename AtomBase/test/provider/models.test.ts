import { expect, test } from "bun:test"
import { ModelsDev } from "@/integrations/provider/models"

test("models.dev fixture is fully validated and optional fields are normalized", async () => {
  const snapshot = await ModelsDev.getWithRevision()
  const database = snapshot.database
  const embedding = database.azure.models["text-embedding-3-small"]

  expect(Object.keys(database).length).toBeGreaterThan(1)
  expect(embedding).toBeDefined()
  expect(embedding.temperature).toBe(false)
  expect(embedding.options).toEqual({})
  expect(database.atomcli.models["muse-spark-1.2-contributor-free"].reasoning_options).toEqual([
    { type: "effort", values: ["minimal", "low", "medium", "high", "xhigh"] },
  ])
  expect(database.atomcli.models["nemotron-3-ultra-free"].reasoning_options).toEqual([])
  expect(snapshot.revision).toBeGreaterThan(0)
  expect(snapshot.revision).toBe(ModelsDev.revision())
})

test("models.dev rejects unknown effort values and reversed token budgets", async () => {
  const model = structuredClone((await ModelsDev.get()).atomcli.models["muse-spark-1.2-contributor-free"])
  expect(
    ModelsDev.Model.safeParse({ ...model, reasoning_options: [{ type: "effort", values: ["ultra"] }] }).success,
  ).toBe(false)
  expect(
    ModelsDev.Model.safeParse({
      ...model,
      reasoning_options: [{ type: "budget_tokens", min: 8_000, max: 4_000 }],
    }).success,
  ).toBe(false)
})
