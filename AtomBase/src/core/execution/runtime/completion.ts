import z from "zod"
import { MessageV2 } from "@/core/session/message-v2"
import type { ExecutionLedger } from "../ledger"
import type { ExecutionRuntime } from "../runtime"

export function parseCompletion(candidate: ExecutionLedger.Completion): ExecutionRuntime.Completion {
  const { payload, reviewFiles, deliveryPayload, deliveryFinish, ...info } = candidate
  return {
    ...info,
    finish: deliveryFinish ?? info.finish,
    parts: MessageV2.TextPart.array().parse(JSON.parse(deliveryPayload ?? payload)),
    editedFiles: z.string().array().parse(JSON.parse(reviewFiles)),
  }
}

export function parseCompletionClaim(candidate: ExecutionLedger.CompletionClaim): ExecutionRuntime.CompletionClaim {
  const { projectorID, projectionToken, projectionLeaseExpiresAt, sessionGeneration, ...completion } = candidate
  return { ...parseCompletion(completion), projectorID, projectionToken, projectionLeaseExpiresAt, sessionGeneration }
}

export function parseClaimOrRecordRecovery(
  candidate: ExecutionLedger.CompletionClaim,
  markRecovery: (input: {
    executionID: string
    digest: string
    projectorID: string
    projectionToken: string
    sessionGeneration: number
    reasonCode: "invalid_payload" | "missing_message"
  }) => void,
  onError: (error: unknown, executionID: string) => void,
) {
  try {
    return parseCompletionClaim(candidate)
  } catch (error) {
    onError(error, candidate.executionID)
    markRecovery({
      executionID: candidate.executionID,
      digest: candidate.digest,
      projectorID: candidate.projectorID,
      projectionToken: candidate.projectionToken,
      sessionGeneration: candidate.sessionGeneration,
      reasonCode: "invalid_payload",
    })
    return undefined
  }
}
