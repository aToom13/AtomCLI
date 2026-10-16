import { Agent } from "@/integrations/agent/agent"
import { HarnessState, escapeXmlText } from "../harness-state"
import { Identifier } from "@/core/id/id"
import { MessageV2 } from "../message-v2"
import PROMPT_PLAN from "./runtime/plan-mode.txt"
import BUILD_SWITCH from "./runtime/build-switch.txt"

export function insertReminders(input: {
  messages: MessageV2.WithParts[]
  agent: Agent.Info
  step: number
  scope?: "direct" | "focused" | "coordinated"
  taskflowAvailable?: boolean
  checkpointRequired?: boolean
}) {
  const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
  if (!userMessage) return input.messages

  const sessionID = userMessage.info.sessionID

  // Single pass: collect synthetic text + metadata to avoid 6 separate O(n×m) scans.
  // Each .some(m => m.parts.some(...)) previously scanned ALL messages × ALL parts.
  // Now one pass builds a Set for O(1) lookups instead.
  const syntheticTexts = new Set<string>()
  let hasTaskflowCall = false
  let wasPlan = false

  for (const msg of input.messages) {
    if (msg.info.role === "assistant" && msg.info.agent === "plan") wasPlan = true
    for (const part of msg.parts) {
      if (part.type === "tool" && (part.tool === "taskflow" || part.tool === "chainupdate")) {
        hasTaskflowCall = true
      }
      if (part.type === "text" && (part as any).synthetic) {
        syntheticTexts.add((part as any).text)
      }
    }
  }

  // Fast substring check across all synthetic texts
  const hasSyntheticText = (substr: string) => {
    for (const text of syntheticTexts) {
      if (text.includes(substr)) return true
    }
    return false
  }

  let aggregatedReminders: string[] = []

  if (input.checkpointRequired) {
    aggregatedReminders.push(
      [
        "<execution_checkpoint>",
        "Execution checkpoint required. Perform genuine self-critique before deciding.",
        "",
        "MANDATORY ANALYSIS (do not skip):",
        "1. What approach did you take in this slice? Was it effective?",
        "2. Which tool calls failed and WHY? Do not repeat the same failing approach.",
        "3. Did you revisit the same files or targets without new results? Why?",
        "4. Is your current strategy working or stuck? Be brutally honest.",
        "5. Only if the strategy is stuck, repeating, or producing no new evidence: name one concrete alternative. If it is working, say why and keep the current bounded approach.",
        "",
        "DELTA REPORTING (required):",
        "- Report ONLY what is new in THIS slice. The harness accumulates history for you.",
        "- completedWork: only items finished in this slice, each tied to concrete evidence",
        "  (a tool result, file diff, test/grep result, browser assertion, or artifact hash).",
        "  Never list something you only believe you changed; if it is unverified, prefix it UNVERIFIED.",
        "- failures: only failures discovered in this slice.",
        "- Do NOT restate items completed in earlier slices.",
        "- Before reporting JavaScript/HTML work as completed, run static_check on the rebuilt",
        "  artifact: a failing static gate means the change is NOT verified, no matter how it looks.",
        "- If an edit set is only partially applied, keep it under remainingWork as an open mutation",
        "  and do NOT mark it completed.",
        "",
        "ROUTE DECISION (respect the harness metrics):",
        "- The harness reports counts below (tool calls, mutating calls, repeated targets, no-progress slices).",
        "- Route cannot be 'keep' while the same target was revisited without new evidence, while no new",
        "  passing evidence was produced, or while a mutation set is still open — address that or revise.",
        '- routeDecision: "keep" only when this slice produced new verified evidence; otherwise "revise".',
        "- selfCritique: honest evaluation of your own performance in this slice. What went well, what went wrong.",
        "- failedApproaches: list approaches you tried that did NOT work (so you do not repeat them).",
        "- whatToChanges: if revise, list specific changes to your approach for the next slice.",
        "",
        "RESPONSE FORMAT:",
        "Respond with one raw JSON object. Fields:",
        '  decision: "continue"|"finish"|"blocked"',
        "  requestedCalls: positive integer (required for continue; harness clamps to 50)",
        "  finalResponse: string (required for finish; user-facing answer)",
        "  objectiveAssessment, progressSummary, discoveries, completedWork, remainingWork,",
        "  If a prior completed claim has insufficient evidence, include invalidatedWork=[{claim: exact prior text, reason}] instead of carrying it as completed. Acceptance comes from the original request; newly discovered defects are repairs, not optional new scope.",
        '  failures, blockers, routeAssessment, routeDecision ("keep"|"revise"),',
        "  selfCritique, failedApproaches, whatToChanges,",
        "  planChanged, routeChanged, estimatedRemainingCalls, nextActions.",
        "",
        "Use [] for empty list fields, false for unchanged booleans, 0 for estimatedRemainingCalls when finished.",
        "Do not call tools, use markdown fences, or emit a second object.",
        "Do not expose hidden chain-of-thought.",
        "</execution_checkpoint>",
      ].join("\n"),
    )
  }

  if (!["reviewer", "checker", "explore", "plan"].includes(input.agent.name)) {
    const toolCallIDs = new Set<string>()
    for (const message of input.messages) {
      for (let index = 0; index < message.parts.length; index++) {
        const part = message.parts[index]
        if (part.type !== "tool") continue
        toolCallIDs.add(part.id || `${message.info.id}:${index}`)
      }
    }
    // Skip when taskflow is not in this turn's toolset (expert episode, last
    // step, permission deny): instructing a call the provider would reject as
    // unavailable produces an `invalid` repair loop instead of progress.
    const progress =
      input.taskflowAvailable === false
        ? undefined
        : HarnessState.consumeTaskflowReminder({
            sessionID,
            toolCallCount: toolCallIDs.size,
          })
    if (progress) {
      const completed = progress.steps.filter((step) => step.status === "completed").length
      const visibleSteps = progress.steps.slice(0, 20)
      const omitted = progress.steps.length - visibleSteps.length
      aggregatedReminders.push(
        [
          `<taskflow_progress trigger="${progress.trigger}" tool_calls_since_last="${progress.toolCallsSinceLast}">`,
          `Taskflow progress: ${completed}/${progress.steps.length} completed.`,
          ...visibleSteps.map((step) => `- [${step.status}] ${escapeXmlText(step.id)}: ${escapeXmlText(step.name)}`),
          ...(omitted > 0 ? [`- ... ${omitted} additional step(s) omitted from this bounded reminder.`] : []),
          progress.statusUnchanged
            ? `Taskflow status has not changed since the previous checkpoint. Reconcile the active task and call taskflow update/complete/fail if its recorded status is stale.`
            : `Review the active task and keep taskflow status synchronized as work proceeds.`,
          `This reminder is advisory: do not mark work complete without evidence.`,
          `</taskflow_progress>`,
        ].join("\n"),
      )
    }
  }

  if (input.agent.name === "plan" && !syntheticTexts.has(PROMPT_PLAN)) {
    aggregatedReminders.push(PROMPT_PLAN)
  }

  if (
    input.scope === "coordinated" &&
    input.taskflowAvailable !== false &&
    !HarnessState.hasActivePlan(sessionID) &&
    !hasSyntheticText("coordinated_plan") &&
    !["reviewer", "checker", "explore", "plan"].includes(input.agent.name)
  ) {
    aggregatedReminders.push(
      "<coordinated_plan>Before a large edit, start taskflow with ordered, testable milestones from the user's acceptance criteria. For a single-file game or app, keep one final source file but build a runnable slice first, then controls and mechanics, then verification and review. Advance only the next pending step.</coordinated_plan>",
    )
  }

  if (wasPlan && input.agent.name === "build") {
    if (!syntheticTexts.has(BUILD_SWITCH)) {
      aggregatedReminders.push(BUILD_SWITCH)
    }

    // Plan→Build barrier: require an active taskflow plan before writing code
    const hasActivePlan = HarnessState.hasActivePlan(sessionID)
    if (!hasActivePlan && input.step <= 2 && !hasSyntheticText("plan_barrier") && input.taskflowAvailable !== false) {
      aggregatedReminders.push(
        [
          "<plan_barrier>",
          "⛔ PLAN→BUILD TRANSITION BARRIER",
          "No active taskflow plan found. Before writing any code you MUST:",
          '1. Call taskflow [action="start", plan=[...]] to load the plan steps',
          "2. Set the first step to running with taskflow update before proceeding",
          "Do NOT skip this step. Jumping directly to code without an active taskflow violates the AUTONOMOUS_GOAL_LOOP rules.",
          "</plan_barrier>",
        ].join("\n"),
      )
    }
  }

  if (
    input.step > 2 &&
    !hasTaskflowCall &&
    !hasSyntheticText("chain_reminder") &&
    input.taskflowAvailable !== false &&
    !["explore", "reviewer", "checker"].includes(input.agent.name)
  ) {
    aggregatedReminders.push(
      "<chain_reminder>⚠️ Step threshold exceeded (>2 steps) without active progress plan. You SHOULD call taskflow [action=start] to initialize progress tracking for the user.</chain_reminder>",
    )
  }

  // ── Harness: BLOCKING ORCHESTRATION MODE reminder ─────────────────────
  if (!["reviewer", "checker", "explore", "plan"].includes(input.agent.name)) {
    const activeWorkflowId = HarnessState.getActiveWorkflowId(sessionID)
    if (activeWorkflowId && !hasSyntheticText("orchestrator_blocking")) {
      aggregatedReminders.push(
        [
          `<orchestrator_blocking workflowId="${activeWorkflowId}">`,
          `⛔ BLOCKING ORCHESTRATION MODE — workflow ${activeWorkflowId} is executing.`,
          `ALL sub-agents are running. You CANNOT do any other work right now.`,
          `Do NOT claim you are doing anything in parallel. You are blocked until all tasks complete.`,
          `When orchestration finishes, you will receive the combined results automatically.`,
          `</orchestrator_blocking>`,
        ].join("\n"),
      )
    }
  }

  // ── Dynamic edit-count reminders (harness enforcement) ──────────────────
  if (!["reviewer", "checker", "plan", "explore"].includes(input.agent.name)) {
    const editReminder = HarnessState.consumeEditReminder(sessionID)

    if (editReminder) {
      if (editReminder.critical) {
        aggregatedReminders.push(
          [
            '<edit_reminder type="critical">',
            `<cause_id>edit_reminder:${sessionID}:${editReminder.revision}</cause_id>`,
            "⚠️ System Reminder: A CRITICAL file (auth/config/database/migration/env/secret) was modified.",
            "You MUST verify correctness before continuing. Run the project typecheck and test commands now.",
            "</edit_reminder>",
          ].join("\n"),
        )
      } else {
        aggregatedReminders.push(
          [
            `<edit_reminder type="high" count="${editReminder.count}">`,
            `<cause_id>edit_reminder:${sessionID}:${editReminder.revision}</cause_id>`,
            `⚠️ System Reminder: ${editReminder.count}+ file edit(s) detected in this session.`,
            "The review gate is ACTIVE: taskflow action='clear' is code-level blocked until the",
            "reviewer sub-agent returns PASS on your changes. Before calling clear:",
            "1. Run the project test and typecheck commands and capture raw output",
            "2. Fix any failures — the reviewer will independently verify with raw logs",
            "</edit_reminder>",
          ].join("\n"),
        )
      }
    }
  }

  if (aggregatedReminders.length > 0) {
    input.messages.push({
      info: {
        id: Identifier.ascending("message"),
        sessionID: sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: input.agent.name,
        model: (userMessage.info as MessageV2.User).model,
      } as MessageV2.User,
      parts: aggregatedReminders.map(
        (text) =>
          ({
            id: Identifier.ascending("part"),
            messageID: "", // Replaced during generation, but not needed for in-memory mapping
            sessionID: sessionID,
            type: "text",
            text: text,
            synthetic: true,
          }) as MessageV2.TextPart,
      ),
    })
  }

  return input.messages
}
