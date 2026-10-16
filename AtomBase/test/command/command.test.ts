import "../preload"
import { expect, spyOn, test } from "bun:test"
import { Command } from "@/interfaces/command"
import { command as runCommand } from "@/core/session/prompt/command"
import { Provider } from "@/integrations/provider/provider"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

test("Superpowers slash commands are available without project command files", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      for (const name of [Command.Default.BRAINSTORM, Command.Default.WRITE_PLAN, Command.Default.EXECUTE_PLAN]) {
        const command = await Command.get(name)
        expect(command?.name).toBe(name)
        expect(command?.hints).toContain("$ARGUMENTS")
        expect(await command?.template).toContain("$ARGUMENTS")
      }
    },
  })
})

test("brainstorm keeps user command visible and sends template as hidden instruction", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const model = spyOn(Provider, "getModel").mockResolvedValue({} as never)
      let parts: { type: string; text: string; synthetic?: boolean }[] = []
      try {
        await runCommand(
          {
            sessionID: "ses_brainstorm_test",
            command: Command.Default.BRAINSTORM,
            arguments: "Plastik pet şişeleri",
            agent: "build",
            model: "test/fixture",
          },
          {
            lastModel: async () => ({ providerID: "test", modelID: "fixture" }),
            resolvePromptParts: async () => [],
            prompt: async (input) => {
              parts = input.parts
              return { info: { id: "msg_brainstorm_test" }, parts: [] } as never
            },
          },
        )
      } finally {
        model.mockRestore()
      }
      expect(parts[0]).toEqual({ type: "text", text: "/brainstorm Plastik pet şişeleri" })
      expect(parts[1]).toMatchObject({ type: "text", synthetic: true })
      expect(parts[1].text).toContain("Plastik pet şişeleri")
    },
  })
})
