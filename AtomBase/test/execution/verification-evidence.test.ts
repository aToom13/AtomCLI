import "../preload"
import { expect, test } from "bun:test"
import { VerificationEvidence } from "@/core/execution/verification-evidence"
import { BashTool } from "@/integrations/tool/bash"
import { Instance } from "@/services/project/instance"
import { Session } from "@/core/session"
import { Identifier } from "@/core/id/id"
import { tmpdir } from "../fixture/fixture"
import { PromptContext } from "@/core/session/prompt/context"
import { HarnessState } from "@/core/session/harness-state"

test("check statuses require independent completed calls and current source evidence", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Bun.write(`${tmp.path}/source.txt`, "original source")
      const session = await Session.create({})
      const id = Identifier.ascending("message")
      await Session.updateMessage({
        id,
        sessionID: session.id,
        role: "user",
        agent: "agent",
        model: { providerID: "test", modelID: "fixture" },
        time: { created: Date.now() },
      })
      const tool = await BashTool.init()
      const run = async (callID: string, command: string, timeout?: number) => {
        const result = await tool.execute(
          { command, description: "Verify command evidence", timeout },
          {
            sessionID: session.id,
            messageID: id,
            callID,
            agent: "agent",
            abort: new AbortController().signal,
            metadata() {},
            ask: async () => {},
          },
        )
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: id,
          sessionID: session.id,
          type: "tool",
          tool: "bash",
          callID,
          state: { status: "completed", input: { command }, ...result, time: { start: Date.now(), end: Date.now() } },
        })
        return result
      }
      const check = async (callID: string) =>
        (await VerificationEvidence.resolve(session.id, [{ name: "check", callID }]))[0]
      await run("pass", "true")
      expect(PromptContext.checkpointDelta(await Session.messages({ sessionID: session.id }))).toContain(
        "verification callID=pass; exit=0",
      )
      expect((await check("pass")).status).toBe("PASS")
      expect((await check("missing")).status).toBe("BLOCKED")
      const early = await run("early", "false; printf never-ran")
      expect(early.output).not.toContain("never-ran")
      expect((await check("early")).status).toBe("FAIL")
      await run("masked", "false || true")
      expect((await check("masked")).status).toBe("BLOCKED")
      await run("redirected", "true 2>/dev/null")
      expect((await check("redirected")).status).toBe("PASS")
      await run("background", "true &")
      expect((await check("background")).status).toBe("BLOCKED")
      await run("no-match", "grep absent source.txt")
      expect((await check("no-match")).reason).toContain("exit 1")
      await run("grep-error", "grep absent nonexistent.txt")
      expect((await check("grep-error")).reason).toContain("exit 2")
      await run("timeout", "sleep 2", 10)
      expect((await check("timeout")).status).toBe("BLOCKED")
      await Bun.write(`${tmp.path}/source.txt`, "changed source")
      expect((await check("pass")).status).toBe("BLOCKED")
      await run("recheck", "true")
      expect((await check("recheck")).status).toBe("PASS")
      expect(
        (await VerificationEvidence.resolve(session.id, [{ name: "old", callID: "recheck" }], Date.now() + 1))[0]
          .status,
      ).toBe("BLOCKED")
      await Bun.write(`${tmp.path}/subject.ts`, "export const value = 0\n")
      await Bun.write(
        `${tmp.path}/masked.test.ts`,
        'import { expect, test } from "bun:test"\nimport { value } from "./subject"\ntest("value", () => expect(value).toBe(1))\n',
      )
      const maskedTest = await run("masked-test", "bun test masked.test.ts || true")
      expect(maskedTest.metadata.exit).toBe(0)
      expect(maskedTest.metadata.verificationSimple).toBe(false)
      expect(HarnessState.failedVerificationCommands(session.id)).toEqual(["bun test masked.test.ts"])
      const redirectedTest = await run(
        "redirected-test",
        "bun test masked.test.ts 2>&1; git diff --no-index /dev/null subject.ts",
      )
      expect(redirectedTest.metadata.exit).toBe(1)
      expect(redirectedTest.metadata.verificationSimple).toBe(false)
      expect(HarnessState.failedVerificationCommands(session.id)).toEqual(["bun test masked.test.ts 2>&1"])
      await Bun.write(`${tmp.path}/subject.ts`, "export const value = 1\n")
      await run("repaired-test", "bun test masked.test.ts")
      expect(HarnessState.failedVerificationCommands(session.id)).toEqual([])
    },
  })
}, 30000)
