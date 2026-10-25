import "../preload"
import { expect, test } from "bun:test"
import { ToolRoute } from "@/server/routes/tool"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

test("tool listing exposes usable parameter schemas and required fields", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const response = await ToolRoute.request("/?provider=test&model=fixture")
      expect(response.status).toBe(200)
      const tools = (await response.json()) as Array<{ id: string; parameters: any }>
      const read = tools.find((tool) => tool.id === "read")!
      expect(read.parameters.type).toBe("object")
      expect(read.parameters.required).toContain("filePath")
      expect(read.parameters.properties.filePath).toMatchObject({ type: "string", minLength: 1, maxLength: 4096 })
      const agent = tools.find((tool) => tool.id === "agent")!
      const actions = (agent.parameters.anyOf ?? [agent.parameters]).flatMap(
        (variant: any) => variant.properties.action.enum ?? [variant.properties.action.const],
      )
      expect(actions).toContain("workflow")
      expect(actions).toContain("spawn")
      expect(actions).toContain("status")
    },
  })
})
