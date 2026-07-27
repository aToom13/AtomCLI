import { describe, expect, test } from "bun:test"
import { HarnessState } from "@/core/session/harness-state"
import { MessageV2 } from "@/core/session/message-v2"
import { SessionPrompt } from "@/core/session/prompt"
import { Instance } from "@/services/project/instance"
import { Agent } from "@/integrations/agent/agent"
import { tmpdir } from "./fixture/fixture"

function createUserMessage(sessionID: string, text: string, id = "msg-user-1"): MessageV2.WithParts {
  return {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: "build",
      model: { providerID: "test", modelID: "test" },
      tools: {},
      mode: "",
    } as unknown as MessageV2.User,
    parts: [
      {
        id: `part-${id}`,
        sessionID,
        messageID: id,
        type: "text",
        text,
      } as MessageV2.TextPart,
    ],
  }
}

function createAssistantMessage(sessionID: string, text: string, id = "msg-asst-1"): MessageV2.WithParts {
  return {
    info: {
      id,
      sessionID,
      role: "assistant",
      time: { created: Date.now() },
      agent: "build",
      modelID: "test",
      providerID: "test",
      mode: "",
    } as unknown as MessageV2.Assistant,
    parts: [
      {
        id: `part-${id}`,
        sessionID,
        messageID: id,
        type: "text",
        text,
      } as MessageV2.TextPart,
    ],
  }
}

const mockAgentInfo: Agent.Info = {
  name: "build",
  mode: "primary",
  permission: [],
  options: {},
}

describe("HarnessState Unit Tests", () => {
  test("tracks edited file count and ignores duplicates", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-edit-track"
        expect(HarnessState.getEditedFileCount(sessionID)).toBe(0)

        HarnessState.addEditedFile(sessionID, "src/index.ts")
        expect(HarnessState.getEditedFileCount(sessionID)).toBe(1)
        expect(HarnessState.getEditedFiles(sessionID)).toEqual(["src/index.ts"])

        // Duplicate edit should not increase count
        HarnessState.addEditedFile(sessionID, "src/index.ts")
        expect(HarnessState.getEditedFileCount(sessionID)).toBe(1)

        HarnessState.addEditedFile(sessionID, "src/utils.ts")
        expect(HarnessState.getEditedFileCount(sessionID)).toBe(2)
        expect(HarnessState.getEditedFiles(sessionID)).toEqual(["src/index.ts", "src/utils.ts"])
      },
    })
  })

  test("detects critical edits using regex keywords", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-critical"
        expect(HarnessState.hasCriticalEdit(sessionID)).toBe(false)

        HarnessState.addEditedFile(sessionID, "src/components/Button.tsx")
        expect(HarnessState.hasCriticalEdit(sessionID)).toBe(false)

        // Test each critical keyword pattern: auth, config, database, migration, .env, secret, password, credential
        const criticalFiles = [
          "src/auth/login.ts",
          "src/config.ts",
          "db/database.ts",
          "db/migration/001_init.sql",
          ".env",
          "keys/secret.json",
          "user/password_reset.ts",
          "aws/credentials.json",
        ]

        for (const file of criticalFiles) {
          const testSession = `session-crit-${file}`
          expect(HarnessState.hasCriticalEdit(testSession)).toBe(false)
          HarnessState.addEditedFile(testSession, file)
          expect(HarnessState.hasCriticalEdit(testSession)).toBe(true)
        }
      },
    })
  })
})

describe("SessionPrompt Synthetic Reminders", () => {
  test("injects medium reminder for 3 edited files", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-rem-3"
        HarnessState.addEditedFile(sessionID, "f1.ts")
        HarnessState.addEditedFile(sessionID, "f2.ts")
        HarnessState.addEditedFile(sessionID, "f3.ts")

        const messages = [createUserMessage(sessionID, "Initial request")]
        const updated = SessionPrompt.insertReminders({
          messages,
          agent: mockAgentInfo,
          step: 1,
        })

        expect(updated.length).toBe(2)
        expect(updated[0].info.id).toBe("msg-user-1")

        const reminderMsg = updated[updated.length - 1]
        expect(reminderMsg.info.role).toBe("user")
        expect((reminderMsg.parts[0] as MessageV2.TextPart).synthetic).toBe(true)
        expect((reminderMsg.parts[0] as MessageV2.TextPart).text).toContain('<edit_reminder type="medium" count="3">')
      },
    })
  })

  test("injects high reminder for 5 edited files", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-rem-5"
        for (let i = 1; i <= 5; i++) {
          HarnessState.addEditedFile(sessionID, `file${i}.ts`)
        }

        const messages = [createUserMessage(sessionID, "Do refactoring")]
        const updated = SessionPrompt.insertReminders({
          messages,
          agent: mockAgentInfo,
          step: 1,
        })

        expect(updated.length).toBe(2)
        const reminderMsg = updated[updated.length - 1]
        expect(reminderMsg.info.role).toBe("user")
        expect((reminderMsg.parts[0] as MessageV2.TextPart).synthetic).toBe(true)
        expect((reminderMsg.parts[0] as MessageV2.TextPart).text).toContain('<edit_reminder type="high" count="5">')
        expect((reminderMsg.parts[0] as MessageV2.TextPart).text).toContain("reviewer subagent")
      },
    })
  })

  test("injects critical reminder for critical file edit", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-rem-crit"
        HarnessState.addEditedFile(sessionID, "src/config/database.ts")

        const messages = [createUserMessage(sessionID, "Update database config")]
        const updated = SessionPrompt.insertReminders({
          messages,
          agent: mockAgentInfo,
          step: 1,
        })

        expect(updated.length).toBe(2)
        const reminderMsg = updated[updated.length - 1]
        expect(reminderMsg.info.role).toBe("user")
        expect((reminderMsg.parts[0] as MessageV2.TextPart).synthetic).toBe(true)
        expect((reminderMsg.parts[0] as MessageV2.TextPart).text).toContain('<edit_reminder type="critical">')
        expect((reminderMsg.parts[0] as MessageV2.TextPart).text).toContain("CRITICAL file")
      },
    })
  })

  test("placing reminder strictly as NEW message at end of array messages[messages.length - 1]", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-placement"
        HarnessState.addEditedFile(sessionID, "a.ts")
        HarnessState.addEditedFile(sessionID, "b.ts")
        HarnessState.addEditedFile(sessionID, "c.ts")

        const msg1 = createUserMessage(sessionID, "First turn", "msg-1")
        const msg2 = createAssistantMessage(sessionID, "Working on it...", "msg-2")
        const msg3 = createUserMessage(sessionID, "Second turn", "msg-3")

        const messages = [msg1, msg2, msg3]
        const updated = SessionPrompt.insertReminders({
          messages,
          agent: mockAgentInfo,
          step: 2,
        })

        // Verify total count increased from 3 to 4
        expect(updated.length).toBe(4)

        // Verify existing messages were NOT mutated or merged into
        expect(updated[0]).toBe(msg1)
        expect(updated[0].parts.length).toBe(1)
        expect((updated[0].parts[0] as MessageV2.TextPart).synthetic).toBeUndefined()

        expect(updated[1]).toBe(msg2)
        expect(updated[2]).toBe(msg3)
        expect(updated[2].parts.length).toBe(1)
        expect((updated[2].parts[0] as MessageV2.TextPart).synthetic).toBeUndefined()

        // Verify the reminder is at messages[messages.length - 1] as a NEW synthetic message
        const lastMsg = updated[updated.length - 1]
        expect(lastMsg.info.role).toBe("user")
        expect(lastMsg.info.id).not.toBe("msg-3")
        expect((lastMsg.parts[0] as MessageV2.TextPart).synthetic).toBe(true)
        expect((lastMsg.parts[0] as MessageV2.TextPart).text).toContain("edit_reminder")
      },
    })
  })

  test("does not duplicate edit reminder if already injected in history", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-dedup"
        HarnessState.addEditedFile(sessionID, "f1.ts")
        HarnessState.addEditedFile(sessionID, "f2.ts")
        HarnessState.addEditedFile(sessionID, "f3.ts")

        const messages = [createUserMessage(sessionID, "User prompt")]
        const updatedOnce = SessionPrompt.insertReminders({
          messages,
          agent: mockAgentInfo,
          step: 1,
        })
        expect(updatedOnce.length).toBe(2)

        // Second call should not inject another edit reminder
        const updatedTwice = SessionPrompt.insertReminders({
          messages: updatedOnce,
          agent: mockAgentInfo,
          step: 2,
        })
        expect(updatedTwice.length).toBe(2)
      },
    })
  })

  test("bypasses edit reminders for excluded agents (reviewer, checker, plan, explore)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-excluded"
        HarnessState.addEditedFile(sessionID, "f1.ts")
        HarnessState.addEditedFile(sessionID, "f2.ts")
        HarnessState.addEditedFile(sessionID, "f3.ts")

        const excludedAgents = ["reviewer", "checker", "plan", "explore"]

        for (const agentName of excludedAgents) {
          const agentInfo: Agent.Info = { ...mockAgentInfo, name: agentName }
          const messages = [createUserMessage(sessionID, "Agent prompt")]
          const updated = SessionPrompt.insertReminders({
            messages,
            agent: agentInfo,
            step: 1,
          })
          const lastMsg = updated[updated.length - 1]
          if (updated.length > 1) {
            expect((lastMsg.parts[0] as MessageV2.TextPart).text).not.toContain("edit_reminder")
          } else {
            expect(updated.length).toBe(1)
          }
        }
      },
    })
  })
})

describe("insertReminders - orchestrator_blocking tag", () => {
  test("injects orchestrator_blocking tag when orchestrator is locked", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-orch-lock"
        const workflowId = "wf-exec-999"

        HarnessState.lockOrchestrator(sessionID, workflowId)

        const messages = [createUserMessage(sessionID, "Run workflow tasks")]
        const updated = SessionPrompt.insertReminders({
          messages,
          agent: mockAgentInfo,
          step: 1,
        })

        expect(updated.length).toBe(2)
        const reminderMsg = updated[updated.length - 1]
        expect(reminderMsg.info.role).toBe("user")
        expect(reminderMsg.parts.length).toBeGreaterThanOrEqual(1)

        const textPart = reminderMsg.parts[0] as MessageV2.TextPart
        expect(textPart.synthetic).toBe(true)
        expect(textPart.text).toContain(`<orchestrator_blocking workflowId="${workflowId}">`)
        expect(textPart.text).toContain("BLOCKING ORCHESTRATION MODE")
        expect(textPart.text).toContain("ALL sub-agents are running")
      },
    })
  })

  test("does not inject duplicate tag if message history already contains synthetic text with orchestrator_blocking", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-orch-dedup"
        const workflowId = "wf-exec-dedup"

        HarnessState.lockOrchestrator(sessionID, workflowId)

        const messages = [createUserMessage(sessionID, "First prompt")]
        const updatedOnce = SessionPrompt.insertReminders({
          messages,
          agent: mockAgentInfo,
          step: 1,
        })
        expect(updatedOnce.length).toBe(2)

        const updatedTwice = SessionPrompt.insertReminders({
          messages: updatedOnce,
          agent: mockAgentInfo,
          step: 2,
        })
        expect(updatedTwice.length).toBe(2)
      },
    })
  })

  test("excludes agents named reviewer, checker, explore, plan from receiving the tag even when locked", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-orch-excluded"
        const workflowId = "wf-exec-bypass"

        HarnessState.lockOrchestrator(sessionID, workflowId)

        const excludedAgents = ["reviewer", "checker", "explore", "plan"]

        for (const agentName of excludedAgents) {
          const agentInfo: Agent.Info = { ...mockAgentInfo, name: agentName }
          const messages = [createUserMessage(sessionID, `Task for ${agentName}`)]
          const updated = SessionPrompt.insertReminders({
            messages,
            agent: agentInfo,
            step: 1,
          })

          if (updated.length > 1) {
            const lastMsg = updated[updated.length - 1]
            const hasOrchTag = lastMsg.parts.some(
              (p) => p.type === "text" && (p as MessageV2.TextPart).text?.includes("orchestrator_blocking"),
            )
            expect(hasOrchTag).toBe(false)
          } else {
            expect(updated.length).toBe(1)
          }
        }
      },
    })
  })

  test("does not inject tag when orchestrator is unlocked / getActiveWorkflowId returns undefined", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-orch-unlocked"

        expect(HarnessState.getActiveWorkflowId(sessionID)).toBeUndefined()

        const messages = [createUserMessage(sessionID, "Normal user query")]
        const updated = SessionPrompt.insertReminders({
          messages,
          agent: mockAgentInfo,
          step: 1,
        })

        expect(updated.length).toBe(1)
      },
    })
  })

  test("injects when locked, stops injecting after unlockOrchestrator", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-orch-lifecycle"
        const workflowId = "wf-exec-lifecycle"

        // 1. Lock orchestrator
        HarnessState.lockOrchestrator(sessionID, workflowId)
        expect(HarnessState.getActiveWorkflowId(sessionID)).toBe(workflowId)

        const msgs1 = [createUserMessage(sessionID, "Prompt while locked")]
        const updatedLocked = SessionPrompt.insertReminders({
          messages: msgs1,
          agent: mockAgentInfo,
          step: 1,
        })
        expect(updatedLocked.length).toBe(2)
        expect((updatedLocked[1].parts[0] as MessageV2.TextPart).text).toContain("orchestrator_blocking")

        // 2. Unlock orchestrator
        HarnessState.unlockOrchestrator(sessionID)
        expect(HarnessState.getActiveWorkflowId(sessionID)).toBeUndefined()

        const msgs2 = [createUserMessage(sessionID, "Prompt after unlock")]
        const updatedUnlocked = SessionPrompt.insertReminders({
          messages: msgs2,
          agent: mockAgentInfo,
          step: 1,
        })
        expect(updatedUnlocked.length).toBe(1)
      },
    })
  })

  test("enforces isolation across multiple sessions (only locked session gets the tag)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionA = "session-orch-A"
        const sessionB = "session-orch-B"
        const workflowIdA = "wf-session-A"

        // Lock session A only
        HarnessState.lockOrchestrator(sessionA, workflowIdA)

        // Session A prompt
        const updatedA = SessionPrompt.insertReminders({
          messages: [createUserMessage(sessionA, "Query A")],
          agent: mockAgentInfo,
          step: 1,
        })
        expect(updatedA.length).toBe(2)
        expect((updatedA[1].parts[0] as MessageV2.TextPart).text).toContain(`workflowId="${workflowIdA}"`)

        // Session B prompt
        const updatedB = SessionPrompt.insertReminders({
          messages: [createUserMessage(sessionB, "Query B")],
          agent: mockAgentInfo,
          step: 1,
        })
        expect(updatedB.length).toBe(1)
      },
    })
  })

  test("combines gracefully with edit count reminders in a single synthetic message", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = "session-orch-combo"
        const workflowId = "wf-combo-123"

        HarnessState.lockOrchestrator(sessionID, workflowId)
        HarnessState.addEditedFile(sessionID, "file1.ts")
        HarnessState.addEditedFile(sessionID, "file2.ts")
        HarnessState.addEditedFile(sessionID, "file3.ts")

        const messages = [createUserMessage(sessionID, "Refactor under orchestration")]
        const updated = SessionPrompt.insertReminders({
          messages,
          agent: mockAgentInfo,
          step: 1,
        })

        expect(updated.length).toBe(2)
        const reminderMsg = updated[1]
        expect(reminderMsg.info.role).toBe("user")

        const partsText = reminderMsg.parts.map((p) => (p as MessageV2.TextPart).text)
        const combinedText = partsText.join("\n")

        expect(combinedText).toContain("orchestrator_blocking")
        expect(combinedText).toContain("edit_reminder")
      },
    })
  })
})

