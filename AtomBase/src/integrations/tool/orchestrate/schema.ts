import z from "zod"
import { MAX_TASK_OUTPUT_BYTES, MAX_TASKS, SAFE_ID } from "./state"
import { ExecutionLedger } from "@/core/execution/ledger"

export const TaskSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(SAFE_ID, "Use letters, numbers, dots, underscores, or hyphens")
    .describe("Unique task identifier"),
  prompt: z.string().min(1).max(100_000).describe("The prompt/instruction for the agent"),
  agent: z.string().max(100).regex(SAFE_ID).optional().describe("Agent type to use (defaults to 'coder')"),
  category: z
    .enum(["coding", "documentation", "analysis", "general"])
    .optional()
    .describe("Task category for smart model routing (auto-inferred from prompt if not specified)"),
  dependsOn: z
    .array(z.string().max(100).regex(SAFE_ID))
    .max(MAX_TASKS)
    .optional()
    .describe("IDs of tasks that must complete before this one"),
  acceptance: z
    .array(ExecutionLedger.TaskAcceptance)
    .max(100)
    .optional()
    .describe("Acceptance criteria checked after the agent submits"),
  skills: z.array(z.string().min(1).max(200)).max(100).optional().describe("Required child skills"),
  model: z
    .string()
    .max(200)
    .optional()
    .describe("Specific model to use (e.g. 'atomcli/minimax-m2.5-free'). If not specified, smart routing is used"),
  sessionId: z.string().max(200).optional().describe("Existing sub-agent session ID to continue (optional)"),
  owns: z
    .array(z.string().max(4096))
    .max(200)
    .optional()
    .describe(
      "Exclusive literal file/directory paths, absolute within the active ownership root or relative to it; no globs or permission grants",
    ),
  budget: z
    .object({
      maxRetries: z.number().int().min(0).max(10).optional().default(2),
      maxOutputChars: z.number().int().min(1_000).max(MAX_TASK_OUTPUT_BYTES).optional().default(MAX_TASK_OUTPUT_BYTES),
    })
    .optional()
    .describe("Per-task retry and output budget"),
  outputSchema: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Optional supported JSON Schema for a validated machine-readable result"),
  validationMode: z.enum(["strict", "permissive"]).optional().default("strict"),
  isolation: z
    .enum(["auto", "required"])
    .optional()
    .default("auto")
    .describe(
      "auto uses Git worktrees when available, otherwise shared workspace with ownership/permission guards; required rejects non-Git plans without downgrade",
    ),
  executionTimeoutSeconds: z.number().int().min(1).max(3_600).optional(),
})

export const RecoverySchema = z.object({
  taskId: z.string().min(1).max(100).regex(SAFE_ID),
  expectedVersion: z.number().int().positive(),
  expectedRevision: z.number().int().positive(),
  artifacts: z.array(z.string().min(1).max(4096)).min(1).max(200),
  verificationCommand: z
    .string()
    .min(1)
    .max(10_000)
    .optional()
    .describe("Required when the original task has no automatic acceptance checks"),
})
