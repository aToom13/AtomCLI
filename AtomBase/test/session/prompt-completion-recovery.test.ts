import { describe, expect, spyOn, test } from "bun:test"
import "../preload"
import { SessionPrompt } from "@/core/session/prompt"
import { Session } from "@/core/session"
import { MessageV2 } from "@/core/session/message-v2"
import { Identifier } from "@/core/id/id"
import { Instance } from "@/services/project/instance"
import { Config } from "@/core/config/config"
import { Storage } from "@/core/storage/storage"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { HarnessState } from "@/core/session/harness-state"
import { ExecutionCheckpoint } from "@/core/execution/checkpoint"
import { ExecutionContract } from "@/core/routing/execution-contract"
import { ExecutionPolicy } from "@/core/routing/execution-policy"
import { SessionCompaction } from "@/core/session/compaction"
import { tmpdir } from "../fixture/fixture"
import { SkillTool } from "@/integrations/tool/skill"
import { ToolRuntime } from "@/integrations/tool/runtime"
import path from "path"
import { TaskVerification } from "@/core/execution/task-verification"

describe("session prompt completion and recovery", () => {
  test.each([
    [true, false, "committed"],
    [false, false, "retry"],
    [true, true, "retry"],
  ] as const)(
    "site audit completion requires requested inspections without replacing visual checks: network=%s visual=%s",
    async (network, visual, expected) => {
      await using tmp = await tmpdir({
        git: true,
        config: {
          review: { enabled: false, policy: "off", reviewer_count: 1, max_attempts: 1, high_risk_patterns: [] },
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const user = (await Session.updateMessage({
            id: Identifier.ascending("message"),
            sessionID: session.id,
            role: "user",
            time: { created: Date.now() },
            agent: "build",
            model: { providerID: "test", modelID: "fixture" },
          })) as MessageV2.User
          const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: user.id })
          ExecutionRuntime.setExecutionContract(
            execution.executionID,
            ExecutionContract.fallback("inspect existing site", {
              intent: "operate",
              deliverables: ["findings.md"],
              expectedSurfaces: ["browser", "network", "workspace"],
              needsExternalAction: true,
              acceptance: ["Inspect accessibility and network activity", ...(visual ? ["Verify a screenshot"] : [])],
            }),
          )
          ExecutionRuntime.recordRuntimeEvidence(execution.executionID, {
            browserNavigations: 1,
            browserAccessibilityCalls: 1,
            browserNetworkCalls: network ? 1 : 0,
          })
          const messageID = Identifier.ascending("message")
          await Session.updateMessage({
            id: messageID,
            parentID: user.id,
            sessionID: session.id,
            role: "assistant",
            agent: user.agent,
            path: { cwd: tmp.path, root: tmp.path },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: user.model.modelID,
            providerID: user.model.providerID,
            time: { created: Date.now() },
          })
          await ToolRuntime.execute({
            tool: "write",
            args: { filePath: path.join(tmp.path, "findings.md") },
            context: {
              sessionID: session.id,
              messageID,
              agent: "build",
              callID: "report",
              abort: new AbortController().signal,
              extra: { execution },
              metadata() {},
              async ask() {},
            },
            execute: async (args) => {
              await Bun.write(
                args.filePath,
                "# Findings\nObserved form submission and inspected accessibility and network data.\n",
              )
              return { title: "findings", output: "findings saved", metadata: {} }
            },
          })
          const candidate = await ExecutionRuntime.stageCompletion({
            sessionID: session.id,
            messageID,
            finish: "stop",
            execution,
            editedFiles: [path.join(tmp.path, "findings.md")],
            requiresReview: false,
            parts: [
              {
                id: Identifier.ascending("part"),
                messageID,
                sessionID: session.id,
                type: "text",
                text: "Findings recorded.",
              },
            ],
          })
          expect(
            await SessionPrompt._internals.resolveCompletion({
              sessionID: session.id,
              lastUser: user,
              execution,
              candidate,
              abort: new AbortController().signal,
            }),
          ).toBe(expected)
        },
      })
    },
  )

  test.each([false, true])(
    "unfinished checkpoint cannot complete without further work: newEvidence=%s",
    async (newEvidence) => {
      await using tmp = await tmpdir({
        git: true,
        config: {
          review: { enabled: false, policy: "off", reviewer_count: 1, max_attempts: 1, high_risk_patterns: [] },
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const user = (await Session.updateMessage({
            id: Identifier.ascending("message"),
            sessionID: session.id,
            role: "user",
            time: { created: Date.now() },
            agent: "build",
            model: { providerID: "test", modelID: "fixture" },
          })) as MessageV2.User
          const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: user.id })
          ExecutionRuntime.setExecutionContract(
            execution.executionID,
            ExecutionContract.fallback("unfinished game", {
              expectedSurfaces: ["workspace", "browser"],
              needsExternalAction: true,
              acceptance: ["Verify requested gameplay"],
            }),
          )
          ExecutionRuntime.recordRuntimeEvidence(execution.executionID, {
            toolCalls: 2,
            browserNavigations: 1,
            browserVerificationCalls: 1,
          })
          ExecutionRuntime.applyCheckpoint(
            execution.executionID,
            Identifier.ascending("message"),
            ExecutionCheckpoint.Result.parse({
              decision: "continue",
              requestedCalls: 10,
              objectiveAssessment: "Launch only; gameplay remains unverified.",
              progressSummary: "App launched",
              discoveries: [],
              completedWork: ["Launch"],
              remainingWork: ["Verify gameplay"],
              failures: [],
              blockers: [],
              routeAssessment: "Continue verification",
              routeDecision: "keep",
              selfCritique: "Smoke is insufficient",
              failedApproaches: [],
              whatToChanges: [],
              planChanged: false,
              routeChanged: false,
              estimatedRemainingCalls: 1,
              nextActions: ["Verify gameplay"],
            }),
            ExecutionRuntime.getExecutionEvidence(execution.executionID),
          )
          if (newEvidence)
            ExecutionRuntime.recordRuntimeEvidence(execution.executionID, {
              toolCalls: 3,
              browserNavigations: 1,
              browserVerificationCalls: 2,
            })
          const messageID = Identifier.ascending("message")
          await Session.updateMessage({
            id: messageID,
            parentID: user.id,
            sessionID: session.id,
            role: "assistant",
            agent: user.agent,
            path: { cwd: tmp.path, root: tmp.path },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: user.model.modelID,
            providerID: user.model.providerID,
            time: { created: Date.now() },
          })
          const candidate = await ExecutionRuntime.stageCompletion({
            sessionID: session.id,
            messageID,
            finish: "stop",
            execution,
            editedFiles: [],
            requiresReview: false,
            parts: [
              {
                id: Identifier.ascending("part"),
                messageID,
                sessionID: session.id,
                type: "text",
                text: "Final report",
              },
            ],
          })
          const outcome = await SessionPrompt._internals.resolveCompletion({
            sessionID: session.id,
            lastUser: user,
            execution,
            candidate,
            abort: new AbortController().signal,
          })
          expect(outcome).toBe(newEvidence ? "committed" : "retry")
          if (!newEvidence) {
            expect(ExecutionRuntime.execution(execution.executionID)?.outcome).not.toBe("completed")
            const retry = (await Session.messages({ sessionID: session.id }))
              .flatMap((item) => item.parts)
              .find((part) => part.type === "text" && part.text.includes("checkpoint still requires work"))
            expect(retry).toBeDefined()
          }
        },
      })
    },
  )

  test.each([
    [false, true, false],
    [true, true, false],
    [true, false, false],
    [true, true, true],
  ])(
    "HTML completion requires current, statically valid source: formatted=%s valid=%s staleBuild=%s",
    async (formatted, valid, staleBuild) => {
      await using tmp = await tmpdir({
        git: true,
        config: {
          formatter: false,
          review: { enabled: false, policy: "off", reviewer_count: 1, max_attempts: 1, high_risk_patterns: [] },
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const user = (await Session.updateMessage({
            id: Identifier.ascending("message"),
            sessionID: session.id,
            role: "user",
            time: { created: Date.now() },
            agent: "build",
            model: { providerID: "test", modelID: "fixture" },
          })) as MessageV2.User
          const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: user.id })
          const messageID = Identifier.ascending("message")
          await Session.updateMessage({
            id: messageID,
            parentID: user.id,
            sessionID: session.id,
            role: "assistant",
            agent: "build",
            path: { cwd: tmp.path, root: tmp.path },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            providerID: "test",
            modelID: "fixture",
            time: { created: Date.now() },
          })
          const html = `<html><head><style>body{background:white;color:navy}button{padding:8px}</style></head><body>${"<button>Increment</button>".repeat(20)}<script>let count=0;function increment(){count+=1}function reset(){count=0}${valid ? "" : ";console.log(undef)"}</script></body></html>`
          const prettier = await import("prettier")
          await Bun.write(
            path.join(tmp.path, "index.html"),
            formatted ? await prettier.format(html, { parser: "html" }) : html,
          )
          HarnessState.addEditedFile(session.id, "index.html")
          if (staleBuild) {
            await Bun.write(
              path.join(tmp.path, "package.json"),
              JSON.stringify({ scripts: { build: "cp index.html built.html" } }),
            )
            const sourceSnapshot = await TaskVerification.buildSnapshot(["index.html"], tmp.path, tmp.path)
            const build = Bun.spawn(["bun", "run", "build"], { cwd: tmp.path, stdout: "pipe", stderr: "pipe" })
            const [output, error, exit] = await Promise.all([
              new Response(build.stdout).text(),
              new Response(build.stderr).text(),
              build.exited,
            ])
            expect(exit, error).toBe(0)
            await Session.updatePart({
              id: Identifier.ascending("part"),
              messageID,
              sessionID: session.id,
              type: "tool",
              tool: "bash",
              callID: "build-fixture",
              state: {
                status: "completed",
                input: { command: "bun run build" },
                output,
                title: "Build fixture",
                metadata: { exit: 0, workdir: tmp.path, sourceSnapshot },
                time: { start: Date.now(), end: Date.now() },
              },
            })
            await Bun.write(
              path.join(tmp.path, "index.html"),
              `${await Bun.file(path.join(tmp.path, "index.html")).text()}\n<!-- latest source -->\n`,
            )
          }
          const { evaluateReviewDecision } = await import("@/integrations/tool/review-gate")
          const reviewDecision = (await evaluateReviewDecision(session.id, execution.executionID)).decision
          const candidate = await ExecutionRuntime.stageCompletion({
            sessionID: session.id,
            messageID,
            finish: "stop",
            parts: [
              { id: Identifier.ascending("part"), messageID, sessionID: session.id, type: "text", text: "Candidate" },
            ],
            editedFiles: ["index.html"],
            requiresReview: false,
            reviewDecision,
            execution,
          })
          expect(
            await SessionPrompt._internals.resolveCompletion({
              sessionID: session.id,
              lastUser: user,
              execution,
              candidate,
              abort: new AbortController().signal,
              allowRetry: false,
            }),
          ).toBe(valid && !staleBuild ? "committed" : "blocked")
          const messages = await Session.messages({ sessionID: session.id })
          if (staleBuild) expect(JSON.stringify(messages)).toContain("source changed after build: bun run build")
          if (!formatted)
            expect(
              messages
                .flatMap((message) => message.parts)
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("\n"),
            ).not.toContain("compressed HTML/CSS/JS")
          if (!valid)
            expect(
              messages
                .flatMap((message) => message.parts)
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("\n"),
            ).toContain("no-undef")
        },
      })
    },
  )

  test.each([
    { leafLoaded: false, explicit: true },
    { leafLoaded: true, explicit: true },
    { leafLoaded: false, explicit: false },
    { leafLoaded: true, explicit: false },
  ])("completion requires reference selection/read: %j", async ({ leafLoaded, explicit }) => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        review: {
          enabled: false,
          policy: "off",
          reviewer_count: 1,
          max_attempts: 1,
          high_risk_patterns: [],
        },
      },
    })
    const root = path.join(tmp.path, ".atomcli/skills/completion-reading")
    await Bun.write(
      path.join(root, "SKILL.md"),
      "---\nname: completion-reading\ndescription: Reading fixture\n---\n# Parent",
    )
    await Bun.write(path.join(root, "references/controls.md"), "Required control and reset instructions")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const user = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test", modelID: "fixture" },
        })) as MessageV2.User
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: user.id,
          sessionID: session.id,
          type: "text",
          text: explicit
            ? "Read completion-reading/references/controls.md before finishing."
            : "Use completion-reading. Keep every interaction reversible.",
        })
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: user.id })
        const messageID = Identifier.ascending("message")
        await Session.updateMessage({
          id: messageID,
          parentID: user.id,
          sessionID: session.id,
          role: "assistant",
          agent: user.agent,
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          providerID: user.model.providerID,
          modelID: user.model.modelID,
          time: { created: Date.now() },
        })
        const parent = await (
          await SkillTool.init()
        ).execute(
          {
            name: "completion-reading",
            ...(!explicit && leafLoaded
              ? {
                  references: ["references/controls.md"],
                  reason: "The parent catalog's controls guide covers reversible interactions.",
                }
              : {}),
          },
          {
            sessionID: session.id,
            messageID,
            agent: "build",
            abort: new AbortController().signal,
            metadata: () => {},
            ask: async () => {},
          },
        )
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID,
          sessionID: session.id,
          type: "tool",
          tool: "skill",
          callID: "parent-read",
          state: {
            status: "completed",
            input: { name: "completion-reading" },
            title: parent.title,
            output: parent.output,
            metadata: parent.metadata,
            time: { start: Date.now(), end: Date.now() },
          },
        })
        const automaticSelectionRecorded = !explicit && !leafLoaded && parent.metadata?.selectedReferences !== undefined
        const referenceLoaded = leafLoaded || automaticSelectionRecorded
        if (leafLoaded) {
          const leaf = await (
            await SkillTool.init()
          ).execute(
            { name: "completion-reading/references/controls.md" },
            {
              sessionID: session.id,
              messageID,
              agent: "build",
              abort: new AbortController().signal,
              metadata: () => {},
              ask: async () => {},
            },
          )
          await Session.updatePart({
            id: Identifier.ascending("part"),
            messageID,
            sessionID: session.id,
            type: "tool",
            tool: "skill",
            callID: "leaf-read",
            state: {
              status: "completed",
              input: { name: "completion-reading/references/controls.md" },
              title: leaf.title,
              output: leaf.output,
              metadata: leaf.metadata,
              time: { start: Date.now(), end: Date.now() },
            },
          })
        }
        const filePath = path.join(tmp.path, "deliverable.txt")
        const write = ToolRuntime.execute({
          tool: "write",
          args: { filePath },
          context: {
            sessionID: session.id,
            messageID,
            callID: "gated-write",
            agent: "build",
            extra: { execution },
            abort: new AbortController().signal,
            metadata: () => {},
            ask: async () => {},
          },
          execute: async () => {
            await Bun.write(filePath, "Applied")
            return { title: "Write", output: "Applied", metadata: {} }
          },
        })
        if (referenceLoaded) {
          await write
          expect(await Bun.file(filePath).text()).toBe("Applied")
        } else {
          await expect(write).rejects.toMatchObject({
            applied: false,
            message: expect.stringContaining(
              explicit ? "completion-reading/references/controls.md, offset=0" : "select relevant references",
            ),
          })
          expect(await Bun.file(filePath).exists()).toBe(false)
        }
        const candidate = await ExecutionRuntime.stageCompletion({
          sessionID: session.id,
          messageID,
          finish: "stop",
          parts: [
            { id: Identifier.ascending("part"), messageID, sessionID: session.id, type: "text", text: "Candidate" },
          ],
          editedFiles: [],
          requiresReview: false,
          execution,
        })
        expect(
          await SessionPrompt._internals.resolveCompletion({
            sessionID: session.id,
            lastUser: user,
            execution,
            candidate,
            abort: new AbortController().signal,
            allowRetry: false,
          }),
        ).toBe(referenceLoaded ? "committed" : "blocked")
        const result = (await Session.messages({ sessionID: session.id })).find(
          (message) => message.info.id === messageID,
        )!
        expect(result.info).toMatchObject({ finish: referenceLoaded ? "stop" : "error" })
        if (!referenceLoaded) {
          expect(
            result.parts
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n"),
          ).toContain(explicit ? "completion-reading/references/controls.md, offset=0" : "select relevant references")
        }
        expect(ExecutionRuntime.execution(execution.executionID)?.outcome).toBe(
          referenceLoaded ? "completed" : "budget_exhausted",
        )
      },
    })
  })
  test("does not retry a commit rejected for a lifecycle reason", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        review: {
          enabled: false,
          policy: "off",
          reviewer_count: 1,
          max_attempts: 1,
          high_risk_patterns: [],
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const session = await Session.create({})
        const user = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          agent: "build",
          model: { providerID: "test", modelID: "fixture" },
          time: { created: Date.now() },
        })) as MessageV2.User
        const userID = Identifier.ascending("message")
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: userID,
          sessionID: session.id,
          type: "text",
          text: "edit",
        })
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: userID })
        const messageID = Identifier.ascending("message")
        await Session.updateMessage({
          id: messageID,
          parentID: user.id,
          sessionID: session.id,
          role: "assistant",
          agent: user.agent,
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: user.model.modelID,
          providerID: user.model.providerID,
          time: { created: Date.now() },
        })
        const part: MessageV2.TextPart = {
          id: Identifier.ascending("part"),
          messageID,
          sessionID: session.id,
          type: "text",
          text: "Completed.",
        }
        const { evaluateReviewDecision } = await import("@/integrations/tool/review-gate")
        const reviewDecision = (await evaluateReviewDecision(session.id)).decision
        const candidate = await ExecutionRuntime.stageCompletion({
          sessionID: session.id,
          messageID,
          finish: "stop",
          parts: [part],
          editedFiles: [],
          requiresReview: false,
          reviewDecision,
          execution,
        })

        // The execution is gone, so the commit is rejected as not_active. That is a
        // lifecycle outcome, not an optimistic-concurrency conflict, so it must
        // surface instead of silently re-hydrating forever.
        ExecutionRuntime.cancelExecution(execution)

        await expect(
          SessionPrompt._internals.resolveCompletion({
            sessionID: session.id,
            lastUser: user,
            execution,
            candidate,
            abort: new AbortController().signal,
          }),
        ).rejects.toThrow()
        expect(ExecutionRuntime.pendingContinuations(session.id)).toHaveLength(0)
      },
    })
  })

  test.each([true, false])("browser verification remains required without source edits: edited=%s", async (edited) => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        review: {
          enabled: false,
          policy: "off",
          reviewer_count: 1,
          max_attempts: 1,
          high_risk_patterns: [],
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.clearCache()
        const session = await Session.create({})
        const user = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "agent",
          model: { providerID: "test", modelID: "fixture" },
        })) as MessageV2.User
        const execution = await ExecutionRuntime.resolveInvocation({
          sessionID: session.id,
          invocationID: user.id,
        })
        ExecutionRuntime.setExecutionContract(execution.executionID, {
          ...ExecutionContract.fallback("browser verification test"),
          expectedSurfaces: ["browser", "workspace"],
          needsExternalAction: true,
        })
        const messageID = Identifier.ascending("message")
        const part: MessageV2.TextPart = {
          id: Identifier.ascending("part"),
          messageID,
          sessionID: session.id,
          type: "text",
          text: "Candidate response",
        }
        await Session.updateMessage({
          id: messageID,
          parentID: user.id,
          sessionID: session.id,
          role: "assistant",
          agent: user.agent,
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: user.model.modelID,
          providerID: user.model.providerID,
          time: { created: Date.now() },
        })
        HarnessState.startPlan(session.id, [{ id: "unfinished", name: "Unfinished work" }])
        await Bun.write(`${tmp.path}/index.html`, "<!doctype html><title>Test</title>")
        const candidate = await ExecutionRuntime.stageCompletion({
          sessionID: session.id,
          messageID,
          finish: "stop",
          parts: [part],
          editedFiles: edited ? ["index.html"] : [],
          requiresReview: false,
          execution,
        })

        expect(
          await SessionPrompt._internals.resolveCompletion({
            sessionID: session.id,
            lastUser: user,
            execution,
            candidate,
            abort: new AbortController().signal,
            allowRetry: false,
          }),
        ).toBe("blocked")
        expect(ExecutionRuntime.pendingContinuations(session.id)).toHaveLength(0)
        expect(ExecutionRuntime.execution(execution.executionID)).toMatchObject({
          lifecycle: "terminal",
          outcome: "budget_exhausted",
          reason: { code: "step_limit" },
        })
        const messages = await Session.messages({ sessionID: session.id })
        const assistant = messages.find((message) => message.info.id === messageID)
        expect(assistant?.info).toMatchObject({ finish: "error" })
        const finalPart = assistant?.parts.find((item) => item.type === "text")
        expect(finalPart?.text).toContain("Candidate response")
        expect(finalPart?.text).toContain("the taskflow plan is still open")
        expect(finalPart?.text).toContain(
          "the inspected site or browser deliverable needs navigation/reload at its original URL",
        )
        expect(finalPart?.text).toContain("the browser deliverable has no visual or behavior check")
        expect(finalPart?.metadata).toMatchObject({ blockerKind: "technical" })
      },
    })
  })

  test("projects an already identical completion without rewriting parts or finish", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const messageID = Identifier.ascending("message")
        const partID = Identifier.ascending("part")
        const completed = Date.now()
        await Session.updateMessage({
          id: messageID,
          role: "assistant",
          parentID: Identifier.ascending("message"),
          sessionID: session.id,
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "fixture",
          providerID: "test",
          time: { created: completed, completed },
          finish: "stop",
        })
        const part = {
          id: partID,
          messageID,
          sessionID: session.id,
          type: "text" as const,
          text: "committed response",
        }
        await Session.updatePart(part)
        const updatePart = spyOn(Session, "updatePartGuarded")
        const updateMessage = spyOn(Session, "updateMessageGuarded")
        try {
          await SessionPrompt._internals.projectCompletion({
            executionID: "execution-projected",
            sessionID: session.id,
            messageID,
            ownerID: "owner",
            fence: 1,
            finish: "stop",
            parts: [part],
            editedFiles: [],
            digest: "digest",
            requiresReview: false,
            revision: 0,
            planRevision: 0,
            routeRevision: 1,
            policyVersion: 1,
            policyDigest: "policy",
            reviewRequirement: "not_required",
            reviewReasonCode: "no_mutations",
            requiredReviewers: 0,
            attemptLimit: 3,
            contentSnapshotDigest: "snapshot",
            projection: "projected",
            state: "committed",
            projectorID: "projector",
            projectionToken: "token",
            projectionLeaseExpiresAt: Date.now() + 10_000,
            sessionGeneration: 1,
          })
          expect(updatePart).not.toHaveBeenCalled()
          expect(updateMessage).not.toHaveBeenCalled()
        } finally {
          updatePart.mockRestore()
          updateMessage.mockRestore()
        }
      },
    })
  })

  test("abandons recovery projection when a durable session tombstone already exists", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await Storage.tombstoneSessions([session.id])
        const result = await SessionPrompt._internals.projectAndAckCompletion({
          executionID: "execution-deleted-session",
          sessionID: session.id,
          messageID: Identifier.ascending("message"),
          ownerID: "owner",
          fence: 1,
          finish: "stop",
          parts: [],
          editedFiles: [],
          digest: "deleted-session-digest",
          requiresReview: false,
          revision: 0,
          planRevision: 0,
          routeRevision: 1,
          policyVersion: 1,
          policyDigest: "policy",
          reviewRequirement: "not_required",
          reviewReasonCode: "no_mutations",
          requiredReviewers: 0,
          attemptLimit: 3,
          contentSnapshotDigest: "snapshot",
          projection: "pending",
          state: "committed",
        })
        expect(result).toBe("abandoned")
        expect(await Storage.sessionGuard(session.id)).toMatchObject({ tombstone: true, generation: 2 })
      },
    })
  })

  test("projects a root cancellation outbox even when no assistant message exists yet", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const userID = Identifier.ascending("message")
        await Session.updateMessage({
          id: userID,
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test", modelID: "fixture" },
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: userID,
          sessionID: session.id,
          type: "text",
          text: "cancel before the provider responds",
        })
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: userID })
        const view = ExecutionRuntime.view(execution.executionID)!
        expect(
          ExecutionRuntime.requestCancel({
            requestID: "cancel-before-assistant",
            executionID: execution.executionID,
            sessionID: session.id,
            projectID: Instance.project.id,
            expectedVersion: view.version,
          }),
        ).toMatchObject({ accepted: true })

        const claim = ExecutionRuntime.claimCompletion(session.id, execution.executionID)
        expect(claim).toBeDefined()
        expect(await SessionPrompt._internals.projectAndAckCompletion(claim!)).toBe("projected")
        const messages = await Session.messages({ sessionID: session.id, excludePatches: false })
        const assistant = messages.find((message) => message.info.id === claim!.messageID)
        expect(assistant?.info).toMatchObject({ role: "assistant", parentID: userID, finish: "error" })
        expect(assistant?.parts).toEqual([
          expect.objectContaining({ type: "text", text: "This execution was cancelled." }),
        ])
        expect(ExecutionRuntime.view(execution.executionID)?.completion?.projection).toBe("projected")
      },
    })
  })

  test("records durable recovery when a committed completion has no projectable message", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const userID = Identifier.ascending("message")
        await Session.updateMessage({
          id: userID,
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test", modelID: "fixture" },
        })
        const execution = await ExecutionRuntime.resolveInvocation({ sessionID: session.id, invocationID: userID })
        const staged = await ExecutionRuntime.stageCompletion({
          sessionID: session.id,
          messageID: Identifier.ascending("message"),
          finish: "stop",
          parts: [],
          editedFiles: [],
          requiresReview: false,
          execution,
        })
        const committed = await ExecutionRuntime.commitCompletion({
          sessionID: session.id,
          execution,
          digest: staged.digest,
        })

        expect(await SessionPrompt._internals.projectAndAckCompletion(committed)).toBe("recovery_required")
        expect(ExecutionRuntime.view(execution.executionID)).toMatchObject({
          recoveryRequired: true,
          completion: { projection: "recovery_required" },
        })
        expect(ExecutionRuntime.claimCompletion(session.id, execution.executionID)).toBeUndefined()
      },
    })
  })

  test("recovers from a model removed since the session was created", async () => {
    await Config.clearCache()
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "default",
          model: { providerID: "atomcli", modelID: "removed-free-model" },
          time: { created: Date.now() },
        })

        const selected = await SessionPrompt._internals.lastModel(session.id)
        expect(selected).not.toEqual({ providerID: "atomcli", modelID: "removed-free-model" })
      },
    })
  })
})
