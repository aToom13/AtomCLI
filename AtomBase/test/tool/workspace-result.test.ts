import "../preload"
import { expect, test } from "bun:test"
import path from "path"
import { BashTool } from "@/integrations/tool/bash"
import { FindTool } from "@/integrations/tool/find"
import { ReadTool } from "@/integrations/tool/read"
import { WriteTool } from "@/integrations/tool/write"
import { EditTool } from "@/integrations/tool/edit"
import { PermissionNext } from "@/util/permission/next"
import { Bus } from "@/core/bus"
import { Instance } from "@/services/project/instance"
import { Identifier } from "@/core/id/id"
import { tmpdir } from "../fixture/fixture"
import type { Tool } from "@/integrations/tool/tool"

test("mkdir does not change Bash workdir; a parent package can make child tests pass", async () => {
  await using project = await tmpdir()
  await Instance.provide({
    directory: project.path,
    fn: async () => {
      const bash = await BashTool.init()
      const context: Tool.Context = {
        sessionID: Identifier.ascending("session"),
        messageID: Identifier.ascending("message"),
        agent: "build",
        abort: new AbortController().signal,
        metadata: () => {},
        ask: async () => {},
      }
      const created = await bash.execute(
        {
          command:
            'mkdir test-debug && printf \'{"scripts":{"test":"bun test ./uniqueNumbers.test.ts"}}\' > package.json && printf \'import {test,expect} from "bun:test"; test("fixture",()=>expect(true).toBe(true))\' > uniqueNumbers.test.ts',
          workdir: project.path,
          description: "Reproduce parent directory writes",
        },
        context,
      )
      expect(created.metadata.exit).toBe(0)
      expect(await Bun.file(path.join(project.path, "uniqueNumbers.test.ts")).exists()).toBe(true)
      expect(await Bun.file(path.join(project.path, "test-debug/uniqueNumbers.test.ts")).exists()).toBe(false)
      const tested = await bash.execute(
        {
          command: "bun run test",
          workdir: path.join(project.path, "test-debug"),
          description: "Reproduce parent package discovery",
        },
        context,
      )
      expect(tested.metadata.exit).toBe(0)
      expect(tested.output).toContain("1 pass")
      expect(await Bun.file(path.join(project.path, "test-debug/package.json")).exists()).toBe(false)
      const cwd = await bash.execute(
        { command: "pwd", workdir: "test-debug", description: "Check actual working directory" },
        context,
      )
      expect(cwd.output.trim()).toBe(path.join(project.path, "test-debug"))
    },
  })
})

test("one-time external approval does not carry into later tools or broader paths", async () => {
  await using project = await tmpdir({ git: true })
  await using external = await tmpdir()
  await Bun.write(path.join(external.path, "visible.txt"), "visible")
  await Instance.provide({
    directory: project.path,
    fn: async () => {
      const sessionID = Identifier.ascending("session")
      const requests: PermissionNext.Request[] = []
      const ruleset: PermissionNext.Ruleset = [
        { permission: "*", pattern: "*", action: "allow" },
        { permission: "external_directory", pattern: "*", action: "ask" },
      ]
      const unsubscribe = Bus.subscribe(PermissionNext.Event.Asked, (event) => {
        requests.push(event.properties)
        void PermissionNext.reply({ requestID: event.properties.id, reply: requests.length === 1 ? "once" : "reject" })
      })
      const context: Tool.Context = {
        sessionID,
        messageID: Identifier.ascending("message"),
        callID: "external-scope",
        agent: "build",
        abort: new AbortController().signal,
        metadata: () => {},
        ask: (request) =>
          PermissionNext.ask({
            ...request,
            sessionID,
            ruleset,
            tool: { messageID: "message", callID: "external-scope" },
          }),
      }
      try {
        const find = await FindTool.init()
        const first = await find.execute({ mode: "tree", path: external.path }, context)
        expect(first.output).toContain("visible.txt")
        expect(requests[0].patterns).toEqual([path.join(external.path, "*")])
        await expect(find.execute({ mode: "tree", path: external.path }, context)).rejects.toBeInstanceOf(
          PermissionNext.RejectedError,
        )
        await expect(find.execute({ mode: "tree", path: path.dirname(external.path) }, context)).rejects.toBeInstanceOf(
          PermissionNext.RejectedError,
        )
        const read = await ReadTool.init()
        await expect(
          read.execute({ filePath: path.join(external.path, "visible.txt") }, context),
        ).rejects.toBeInstanceOf(PermissionNext.RejectedError)
        const write = await WriteTool.init()
        await expect(
          write.execute({ filePath: path.join(external.path, "new.txt"), content: "denied" }, context),
        ).rejects.toBeInstanceOf(PermissionNext.RejectedError)
        expect(await Bun.file(path.join(external.path, "new.txt")).exists()).toBe(false)
        const edit = await EditTool.init()
        await expect(
          edit.execute(
            { filePath: path.join(external.path, "visible.txt"), oldString: "visible", newString: "changed" },
            context,
          ),
        ).rejects.toMatchObject({ applied: false, message: expect.stringContaining("user rejected permission") })
        expect(await Bun.file(path.join(external.path, "visible.txt")).text()).toBe("visible")
        const bash = await BashTool.init()
        await expect(
          bash.execute({ command: `ls -1 "${external.path}"`, description: "Try rejected read through Bash" }, context),
        ).rejects.toBeInstanceOf(PermissionNext.RejectedError)
        expect(requests).toHaveLength(7)
      } finally {
        unsubscribe()
      }
    },
  })
})

test.each(["ls", "find", "cat", "stat"])("Bash %s cannot bypass an external-directory denial", async (command) => {
  await using project = await tmpdir()
  await using external = await tmpdir()
  const filepath = path.join(external.path, "visible.txt")
  await Bun.write(filepath, "visible")
  await Instance.provide({
    directory: project.path,
    fn: async () => {
      const bash = await BashTool.init()
      const sessionID = Identifier.ascending("session")
      const ruleset: PermissionNext.Ruleset = [
        { permission: "*", pattern: "*", action: "allow" },
        { permission: "external_directory", pattern: "*", action: "deny" },
      ]
      await expect(
        bash.execute(
          {
            command: `${command} '${command === "ls" || command === "find" ? external.path : filepath}'`,
            description: "Check command path permission",
          },
          {
            sessionID,
            messageID: Identifier.ascending("message"),
            agent: "build",
            abort: new AbortController().signal,
            metadata: () => {},
            ask: (request) => PermissionNext.ask({ ...request, sessionID, ruleset }),
          },
        ),
      ).rejects.toBeInstanceOf(PermissionNext.DeniedError)
    },
  })
})

test("Bash rejects external writes before spawning, while internal commands still run", async () => {
  await using project = await tmpdir()
  await using external = await tmpdir()
  await Instance.provide({
    directory: project.path,
    fn: async () => {
      const bash = await BashTool.init()
      const sessionID = Identifier.ascending("session")
      const ruleset: PermissionNext.Ruleset = [
        { permission: "*", pattern: "*", action: "allow" },
        { permission: "external_directory", pattern: "*", action: "deny" },
      ]
      const context: Tool.Context = {
        sessionID,
        messageID: Identifier.ascending("message"),
        agent: "build",
        abort: new AbortController().signal,
        metadata: () => {},
        ask: (request) => PermissionNext.ask({ ...request, sessionID, ruleset }),
      }
      const filepath = path.join(external.path, "new.txt")
      await expect(
        bash.execute(
          { command: `printf denied > "${filepath}"`, description: "Try external shell redirection" },
          context,
        ),
      ).rejects.toBeInstanceOf(PermissionNext.DeniedError)
      expect(await Bun.file(filepath).exists()).toBe(false)
      await expect(
        bash.execute({ command: `touch "${filepath}"`, description: "Try external file modification" }, context),
      ).rejects.toBeInstanceOf(PermissionNext.DeniedError)
      const result = await bash.execute(
        { command: "printf allowed > internal.txt", description: "Write within permitted workspace" },
        context,
      )
      expect(result.metadata.exit).toBe(0)
      expect(await Bun.file(path.join(project.path, "internal.txt")).text()).toBe("allowed")
      await expect(
        bash.execute(
          { command: "printf denied > blocked.txt", description: "Check independent command denial" },
          {
            ...context,
            ask: (request) =>
              PermissionNext.ask({
                ...request,
                sessionID,
                ruleset: [
                  { permission: "*", pattern: "*", action: "allow" },
                  { permission: "bash", pattern: "*", action: "deny" },
                ],
              }),
          },
        ),
      ).rejects.toBeInstanceOf(PermissionNext.DeniedError)
      expect(await Bun.file(path.join(project.path, "blocked.txt")).exists()).toBe(false)
    },
  })
})

test("a one-time approval cannot override a denied second path in the same command", async () => {
  await using project = await tmpdir({ git: true })
  await using allowed = await tmpdir()
  await using denied = await tmpdir()
  await Instance.provide({
    directory: project.path,
    fn: async () => {
      const bash = await BashTool.init()
      const sessionID = Identifier.ascending("session")
      let prompts = 0
      const unsubscribe = Bus.subscribe(PermissionNext.Event.Asked, (event) => {
        prompts++
        void PermissionNext.reply({ requestID: event.properties.id, reply: "once" })
      })
      try {
        await expect(
          bash.execute(
            { command: `ls "${allowed.path}" && ls "${denied.path}"`, description: "Check every requested path" },
            {
              sessionID,
              messageID: Identifier.ascending("message"),
              agent: "build",
              abort: new AbortController().signal,
              metadata: () => {},
              ask: (request) =>
                PermissionNext.ask({
                  ...request,
                  sessionID,
                  ruleset: [
                    { permission: "*", pattern: "*", action: "allow" },
                    { permission: "external_directory", pattern: "*", action: "ask" },
                    { permission: "external_directory", pattern: path.join(denied.path, "*"), action: "deny" },
                  ],
                }),
            },
          ),
        ).rejects.toBeInstanceOf(PermissionNext.DeniedError)
        expect(prompts).toBe(0)
      } finally {
        unsubscribe()
      }
    },
  })
})
