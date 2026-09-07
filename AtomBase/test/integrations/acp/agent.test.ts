import "../../preload"
import { expect, mock, test } from "bun:test"
import { RequestError } from "@agentclientprotocol/sdk"
import { ACP } from "@/integrations/acp/agent"
import { Auth } from "@/services/auth"

test("ACP maps durable terminal outcomes to protocol stop reasons", () => {
  expect(
    ACP._internals.executionPromptResponse({
      id: "completed",
      lifecycle: "terminal",
      outcome: "completed",
    }),
  ).toMatchObject({ stopReason: "end_turn", _meta: { executionOutcome: "completed" } })
  expect(
    ACP._internals.executionPromptResponse({
      id: "cancelled",
      lifecycle: "terminal",
      outcome: "cancelled",
      reason: { code: "user_cancelled", message: "Cancelled", retryable: false },
    }),
  ).toMatchObject({ stopReason: "cancelled", _meta: { executionOutcome: "cancelled" } })
  expect(
    ACP._internals.executionPromptResponse({
      id: "calls",
      lifecycle: "terminal",
      outcome: "budget_exhausted",
      reason: { code: "call_limit", message: "Call limit", retryable: false },
    }),
  ).toMatchObject({ stopReason: "max_turn_requests", _meta: { reasonCode: "call_limit" } })
  expect(
    ACP._internals.executionPromptResponse({
      id: "tokens",
      lifecycle: "terminal",
      outcome: "budget_exhausted",
      reason: { code: "cost_limit", message: "Cost limit", retryable: false },
    }),
  ).toMatchObject({ stopReason: "max_tokens", _meta: { reasonCode: "cost_limit" } })
  expect(
    ACP._internals.executionPromptResponse({
      id: "blocked",
      lifecycle: "terminal",
      outcome: "blocked",
      reason: { code: "review_rejected", message: "Review rejected", retryable: false },
    }),
  ).toMatchObject({ stopReason: "refusal", _meta: { executionOutcome: "blocked" } })
})

test("ACP authenticate accepts only its advertised method and verifies stored credentials", async () => {
  const agent = new ACP.Agent({} as never, { sdk: {} as never })
  await expect(agent.authenticate({ methodId: "unknown" })).rejects.toBeInstanceOf(RequestError)

  const original = Auth.all
  Auth.all = mock(async () => ({}))
  try {
    await expect(agent.authenticate({ methodId: "atomcli-login" })).rejects.toBeInstanceOf(RequestError)
    Auth.all = mock(async () => ({ openai: { type: "api" as const, key: "test-fake-key" } }))
    await expect(agent.authenticate({ methodId: "atomcli-login" })).resolves.toMatchObject({
      _meta: { authenticated: true },
    })
  } finally {
    Auth.all = original
  }
})
