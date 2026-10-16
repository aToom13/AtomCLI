import type { MessageV2 } from "@/core/session/message-v2"
import type { ExecutionLedger } from "../ledger"

export namespace RuntimeTypes {
  export type Context = ExecutionLedger.Context

  export type Completion = Omit<
    ExecutionLedger.Completion,
    "payload" | "reviewFiles" | "deliveryPayload" | "deliveryFinish"
  > & {
    parts: MessageV2.TextPart[]
    editedFiles: string[]
  }

  export type CompletionClaim = Completion & {
    projectorID: string
    projectionToken: string
    projectionLeaseExpiresAt: number
    sessionGeneration: number
  }

  export type ReviewDecision = {
    policyVersion: number
    policyDigest: string
    requirement: "required" | "not_required" | "user_bypass"
    reasonCode: string
    requiredReviewers: number
    attemptLimit: number
  }

  export type TerminalFailure = {
    outcome: "failed" | "cancelled" | "budget_exhausted" | "blocked"
    reasonCode: ExecutionLedger.ReasonCode
    reasonMessage: string
    retryable: boolean
  }
}
