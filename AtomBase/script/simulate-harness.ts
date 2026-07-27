#!/usr/bin/env bun
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import { HarnessState } from "@/core/session/harness-state"
import { SessionPrompt } from "@/core/session/prompt"
import { MessageV2 } from "@/core/session/message-v2"
import { Instance } from "@/services/project/instance"
import { Agent } from "@/integrations/agent/agent"
import { Identifier } from "@/core/id/id"
import { tmpdir } from "../test/fixture/fixture"
import { Log } from "@/util/util/log"

// Ensure MODELS_DEV_API_JSON fixture path is set for model resolution
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const atomBaseDir = path.resolve(__dirname, "..")

process.env.MODELS_DEV_API_JSON = process.env.MODELS_DEV_API_JSON || path.join(atomBaseDir, "test/tool/fixtures/models-api.json")

// Suppress internal logging to ensure clean CLI simulation output
Log.init({ print: false })

function createInitialUserMessage(sessionID: string, agentName: string): MessageV2.WithParts {
  const msgId = Identifier.ascending("message")
  const partId = Identifier.ascending("part")
  return {
    info: {
      id: msgId,
      sessionID: sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: agentName,
      model: { providerID: "atomcli", modelID: "minimax-m2.5-free" },
    } as MessageV2.User,
    parts: [
      {
        id: partId,
        sessionID: sessionID,
        messageID: msgId,
        type: "text",
        text: "Please refactor the requested code components and keep project updated.",
      } as MessageV2.TextPart,
    ],
  }
}

function formatMessagesState(messages: MessageV2.WithParts[]): string {
  return messages.map((m, idx) => {
    const isSynthetic = m.parts.some((p: any) => p.synthetic)
    const roleTag = isSynthetic ? `${m.info.role} (SYNTHETIC)` : m.info.role
    const partsSummary = m.parts.map((p: any) => {
      if (p.type === "text") {
        const preview = p.text.length > 120 ? p.text.slice(0, 117) + "..." : p.text
        return `      [text${p.synthetic ? " (synthetic)" : ""}] ${JSON.stringify(preview)}`
      }
      return `      [${p.type}]`
    }).join("\n")
    return `  Message #${idx + 1} (${m.info.id}) | Role: ${roleTag}\n${partsSummary}`
  }).join("\n")
}

async function runSimulation() {
  console.log("==========================================================================")
  console.log("          AtomCLI Harness System Reminder Ingestion Simulation            ")
  console.log("==========================================================================")

  await using tmp = await tmpdir({ git: true })
  
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      let agent: Agent.Info
      try {
        agent = await Agent.get("build")
      } catch {
        agent = {
          name: "build",
          mode: "primary",
          permission: {} as any,
          options: {},
        } as Agent.Info
      }

      // ------------------------------------------------------------------------
      // Scenario 1: Edit 3 distinct files -> verify medium edit reminder
      // ------------------------------------------------------------------------
      {
        console.log("\n--------------------------------------------------------------------------")
        console.log("SCENARIO 1: Modifying 3 distinct non-critical files (Medium Threshold)")
        console.log("--------------------------------------------------------------------------")

        const sessionID = Identifier.ascending("session")
        HarnessState.reset(sessionID)

        const filesToEdit = [
          "src/components/Header.tsx",
          "src/components/Sidebar.tsx",
          "src/components/Footer.tsx",
        ]

        console.log(`[SIMULATION] Registering file edits for session: ${sessionID}`)
        for (const file of filesToEdit) {
          HarnessState.addEditedFile(sessionID, file)
          console.log(`  - Edit recorded: ${file}`)
        }

        console.log(`\n[STATE] Harness Edited File Count: ${HarnessState.getEditedFileCount(sessionID)}`)
        console.log(`[STATE] Harness Has Critical Edit: ${HarnessState.hasCriticalEdit(sessionID)}`)

        const initialMessages = [createInitialUserMessage(sessionID, agent.name)]
        console.log("\n[BEFORE INJECTION] Message array state:")
        console.log(formatMessagesState(initialMessages))

        const resultMessages = SessionPrompt.insertReminders({
          messages: [...initialMessages],
          agent,
          step: 1,
        })

        console.log("\n[AFTER INJECTION] Message array state:")
        console.log(formatMessagesState(resultMessages))

        // Assertions for Scenario 1
        if (resultMessages.length !== 2) {
          throw new Error(`Scenario 1 Failed: Expected 2 messages, got ${resultMessages.length}`)
        }

        const lastMessage = resultMessages[resultMessages.length - 1]
        if (lastMessage.info.role !== "user") {
          throw new Error(`Scenario 1 Failed: Last message role is not 'user' (${lastMessage.info.role})`)
        }

        const syntheticPart = lastMessage.parts.find(
          (p) => p.type === "text" && Boolean((p as any).synthetic) && (p as MessageV2.TextPart).text.includes('<edit_reminder type="medium"'),
        ) as MessageV2.TextPart | undefined
        if (!syntheticPart) {
          throw new Error('Scenario 1 Failed: Synthetic part with <edit_reminder type="medium"> not found in final message')
        }

        if (!syntheticPart.text.includes('count="3"')) {
          throw new Error('Scenario 1 Failed: Synthetic part missing count="3" attribute')
        }

        console.log("\n[INJECTED SYNTHETIC REMINDER CONTENT]:")
        console.log(syntheticPart.text)
        console.log("\n✅ [SCENARIO 1 SUCCESS] Medium edit reminder correctly injected at end of context window.")
      }

      // ------------------------------------------------------------------------
      // Scenario 2: Edit 5 distinct files -> verify high edit reminder
      // ------------------------------------------------------------------------
      {
        console.log("\n--------------------------------------------------------------------------")
        console.log("SCENARIO 2: Modifying 5 distinct non-critical files (High Threshold)")
        console.log("--------------------------------------------------------------------------")

        const sessionID = Identifier.ascending("session")
        HarnessState.reset(sessionID)

        const filesToEdit = [
          "src/utils/math.ts",
          "src/utils/string.ts",
          "src/utils/date.ts",
          "src/utils/array.ts",
          "src/utils/object.ts",
        ]

        console.log(`[SIMULATION] Registering file edits for session: ${sessionID}`)
        for (const file of filesToEdit) {
          HarnessState.addEditedFile(sessionID, file)
          console.log(`  - Edit recorded: ${file}`)
        }

        console.log(`\n[STATE] Harness Edited File Count: ${HarnessState.getEditedFileCount(sessionID)}`)
        console.log(`[STATE] Harness Has Critical Edit: ${HarnessState.hasCriticalEdit(sessionID)}`)

        const initialMessages = [createInitialUserMessage(sessionID, agent.name)]
        console.log("\n[BEFORE INJECTION] Message array state:")
        console.log(formatMessagesState(initialMessages))

        const resultMessages = SessionPrompt.insertReminders({
          messages: [...initialMessages],
          agent,
          step: 1,
        })

        console.log("\n[AFTER INJECTION] Message array state:")
        console.log(formatMessagesState(resultMessages))

        // Assertions for Scenario 2
        if (resultMessages.length !== 2) {
          throw new Error(`Scenario 2 Failed: Expected 2 messages, got ${resultMessages.length}`)
        }

        const lastMessage = resultMessages[resultMessages.length - 1]
        if (lastMessage.info.role !== "user") {
          throw new Error(`Scenario 2 Failed: Last message role is not 'user' (${lastMessage.info.role})`)
        }

        const syntheticPart = lastMessage.parts.find(
          (p) => p.type === "text" && Boolean((p as any).synthetic) && (p as MessageV2.TextPart).text.includes('<edit_reminder type="high"'),
        ) as MessageV2.TextPart | undefined
        if (!syntheticPart) {
          throw new Error('Scenario 2 Failed: Synthetic part with <edit_reminder type="high"> not found in final message')
        }

        if (!syntheticPart.text.includes('count="5"')) {
          throw new Error('Scenario 2 Failed: Synthetic part missing count="5" attribute')
        }

        console.log("\n[INJECTED SYNTHETIC REMINDER CONTENT]:")
        console.log(syntheticPart.text)
        console.log("\n✅ [SCENARIO 2 SUCCESS] High edit reminder correctly injected at end of context window.")
      }

      // ------------------------------------------------------------------------
      // Scenario 3: Edit a critical file -> verify critical edit reminder
      // ------------------------------------------------------------------------
      {
        console.log("\n--------------------------------------------------------------------------")
        console.log("SCENARIO 3: Modifying a critical file (Critical Regex Match)")
        console.log("--------------------------------------------------------------------------")

        const sessionID = Identifier.ascending("session")
        HarnessState.reset(sessionID)

        const filesToEdit = [
          "src/app.ts",
          "config.json", // Matches critical regex /config/
        ]

        console.log(`[SIMULATION] Registering file edits for session: ${sessionID}`)
        for (const file of filesToEdit) {
          HarnessState.addEditedFile(sessionID, file)
          console.log(`  - Edit recorded: ${file}`)
        }

        console.log(`\n[STATE] Harness Edited File Count: ${HarnessState.getEditedFileCount(sessionID)}`)
        console.log(`[STATE] Harness Has Critical Edit: ${HarnessState.hasCriticalEdit(sessionID)}`)

        const initialMessages = [createInitialUserMessage(sessionID, agent.name)]
        console.log("\n[BEFORE INJECTION] Message array state:")
        console.log(formatMessagesState(initialMessages))

        const resultMessages = SessionPrompt.insertReminders({
          messages: [...initialMessages],
          agent,
          step: 1,
        })

        console.log("\n[AFTER INJECTION] Message array state:")
        console.log(formatMessagesState(resultMessages))

        // Assertions for Scenario 3
        if (resultMessages.length !== 2) {
          throw new Error(`Scenario 3 Failed: Expected 2 messages, got ${resultMessages.length}`)
        }

        const lastMessage = resultMessages[resultMessages.length - 1]
        if (lastMessage.info.role !== "user") {
          throw new Error(`Scenario 3 Failed: Last message role is not 'user' (${lastMessage.info.role})`)
        }

        const syntheticPart = lastMessage.parts.find(
          (p) => p.type === "text" && Boolean((p as any).synthetic) && (p as MessageV2.TextPart).text.includes('<edit_reminder type="critical"'),
        ) as MessageV2.TextPart | undefined
        if (!syntheticPart) {
          throw new Error('Scenario 3 Failed: Synthetic part with <edit_reminder type="critical"> not found in final message')
        }

        console.log("\n[INJECTED SYNTHETIC REMINDER CONTENT]:")
        console.log(syntheticPart.text)
        console.log("\n✅ [SCENARIO 3 SUCCESS] Critical edit reminder correctly injected at end of context window.")
      }

      console.log("\n==========================================================================")
      console.log("  ALL 3 HARNESS EDIT REMINDER SIMULATION SCENARIOS PASSED SUCCESSFULLY!   ")
      console.log("==========================================================================")
    },
  })
}

runSimulation().then(() => {
  process.exit(0)
}).catch((err) => {
  console.error("\n❌ Simulation encountered an error:", err)
  process.exit(1)
})
