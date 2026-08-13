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
  expect(snapshot.revision).toBeGreaterThan(0)
  expect(snapshot.revision).toBe(ModelsDev.revision())
})
