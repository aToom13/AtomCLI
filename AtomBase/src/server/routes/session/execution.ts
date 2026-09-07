import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { ExecutionLedger } from "@/core/execution/ledger"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { Session } from "@/core/session"
import { Instance } from "@/services/project/instance"
import { errors } from "../../error"

const RequestID = z.string().min(1).max(200)
const ExecutionParam = z.object({
  sessionID: z.string(),
  executionID: z.string(),
})
const MutationResponse = z.object({
  requestID: RequestID,
  idempotent: z.boolean(),
  execution: ExecutionLedger.ExecutionView,
})
const EventPage = z.object({
  epoch: z.string(),
  cursor: ExecutionLedger.Cursor,
  items: ExecutionLedger.EventEnvelope.array(),
  resyncRequired: z.boolean(),
  reason: z.enum(["epoch_changed", "cursor_ahead", "retention_gap"]).optional(),
})
const RouteDecisionResponse = z.object({
  requestID: RequestID,
  idempotent: z.boolean(),
  proposal: ExecutionLedger.RouteProposal,
})

async function rootScope(sessionID: string) {
  let session = await Session.get(sessionID)
  const visited = new Set<string>()
  while (session.parentID && !visited.has(session.id)) {
    visited.add(session.id)
    session = await Session.get(session.parentID)
  }
  return { sessionID: session.id, projectID: session.projectID }
}

function failureStatus(reason: string) {
  if (reason === "not_found" || reason === "invocation_not_found" || reason === "work_not_found") return 404 as const
  if (reason === "evidence_required") return 422 as const
  return 409 as const
}

export const SessionExecutionRoute = new Hono()
  .get(
    "/:sessionID/executions",
    describeRoute({
      summary: "List session executions",
      description: "List durable execution outcomes and active work for a session using a scope-bound cursor.",
      tags: ["Session"],
      operationId: "session.executions.list",
      responses: {
        200: {
          description: "Execution page",
          content: { "application/json": { schema: resolver(ExecutionLedger.ExecutionList) } },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator(
      "query",
      z.object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      }),
    ),
    async (c) => {
      const scope = await rootScope(c.req.valid("param").sessionID)
      const query = c.req.valid("query")
      return c.json(ExecutionRuntime.list({ sessionID: scope.sessionID, cursor: query.cursor, limit: query.limit }))
    },
  )
  .get(
    "/:sessionID/execution-snapshot",
    describeRoute({
      summary: "Get session execution snapshot",
      description: "Get a transaction-consistent execution snapshot and durable event cursor for reconnect.",
      tags: ["Session"],
      operationId: "session.executions.snapshot",
      responses: {
        200: {
          description: "Execution snapshot",
          content: { "application/json": { schema: resolver(ExecutionLedger.ExecutionSnapshot) } },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    async (c) => {
      const scope = await rootScope(c.req.valid("param").sessionID)
      return c.json(ExecutionRuntime.snapshot(scope.sessionID))
    },
  )
  .get(
    "/:sessionID/execution-events",
    describeRoute({
      summary: "Replay session execution events",
      description: "Replay durable execution events after a cursor or request an explicit snapshot resync.",
      tags: ["Session"],
      operationId: "session.executions.events",
      responses: {
        200: {
          description: "Execution event page",
          content: { "application/json": { schema: resolver(EventPage) } },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator(
      "query",
      z.object({
        epoch: z.string().optional(),
        sequence: z.coerce.number().int().nonnegative().default(0),
        limit: z.coerce.number().int().min(1).max(100).default(100),
      }),
    ),
    async (c) => {
      const scope = await rootScope(c.req.valid("param").sessionID)
      const query = c.req.valid("query")
      const cursor = query.epoch ? { epoch: query.epoch, sequence: query.sequence } : query.sequence
      return c.json(ExecutionRuntime.events(scope.sessionID, cursor, query.limit))
    },
  )
  .get(
    "/:sessionID/executions/:executionID",
    describeRoute({
      summary: "Get session execution",
      description: "Get one durable execution after verifying its project and root-session scope.",
      tags: ["Session"],
      operationId: "session.executions.get",
      responses: {
        200: {
          description: "Execution detail",
          content: { "application/json": { schema: resolver(ExecutionLedger.ExecutionView) } },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", ExecutionParam),
    async (c) => {
      const param = c.req.valid("param")
      const scope = await rootScope(param.sessionID)
      const execution = ExecutionRuntime.view(param.executionID)
      if (!execution || execution.rootSessionID !== scope.sessionID || execution.projectID !== Instance.project.id) {
        return c.json({ error: "execution_not_found" }, 404)
      }
      return c.json(execution)
    },
  )
  .post(
    "/:sessionID/executions/:executionID/cancel",
    describeRoute({
      summary: "Cancel a session execution",
      description: "Request an idempotent root or child-invocation cancellation with execution-version CAS.",
      tags: ["Session"],
      operationId: "session.executions.cancel",
      responses: {
        202: {
          description: "Cancellation accepted",
          content: { "application/json": { schema: resolver(MutationResponse) } },
        },
        ...errors(400, 404, 409, 422),
      },
    }),
    validator("param", ExecutionParam),
    validator(
      "json",
      z.object({
        requestID: RequestID,
        expectedVersion: z.number().int().positive(),
        invocationID: z.string().optional(),
      }),
    ),
    async (c) => {
      const param = c.req.valid("param")
      const body = c.req.valid("json")
      const scope = await rootScope(param.sessionID)
      const result = ExecutionRuntime.requestCancel({
        ...body,
        executionID: param.executionID,
        sessionID: scope.sessionID,
        projectID: scope.projectID,
      })
      if (!result.accepted)
        return c.json(
          { error: result.reason, version: "version" in result ? result.version : undefined },
          failureStatus(result.reason),
        )
      return c.json({ requestID: body.requestID, idempotent: result.idempotent, execution: result.execution }, 202)
    },
  )
  .post(
    "/:sessionID/executions/:executionID/reconcile",
    describeRoute({
      summary: "Reconcile uncertain execution work",
      description: "Resolve one unknown physical operation with bounded evidence and execution/work CAS versions.",
      tags: ["Session"],
      operationId: "session.executions.reconcile",
      responses: {
        200: {
          description: "Reconciliation accepted",
          content: { "application/json": { schema: resolver(MutationResponse) } },
        },
        ...errors(400, 404, 409, 422),
      },
    }),
    validator("param", ExecutionParam),
    validator(
      "json",
      z.object({
        requestID: RequestID,
        operationID: z.string().min(1).max(300),
        state: z.enum(["completed", "failed", "cancelled"]),
        expectedVersion: z.number().int().positive(),
        expectedWorkVersion: z.number().int().positive(),
        evidence: z
          .string()
          .min(1)
          .max(16 * 1024),
        resolutionCode: z.string().min(1).max(200),
      }),
    ),
    async (c) => {
      const param = c.req.valid("param")
      const body = c.req.valid("json")
      const scope = await rootScope(param.sessionID)
      const result = ExecutionRuntime.requestReconcile({
        ...body,
        executionID: param.executionID,
        sessionID: scope.sessionID,
        projectID: scope.projectID,
      })
      if (!result.reconciled)
        return c.json(
          { error: result.reason, version: "version" in result ? result.version : undefined },
          failureStatus(result.reason),
        )
      return c.json({ requestID: body.requestID, idempotent: result.idempotent, execution: result.execution })
    },
  )
  .post(
    "/:sessionID/executions/:executionID/route-proposals/:proposalID/decision",
    describeRoute({
      summary: "Decide a route proposal",
      description: "Accept or reject a durable route proposal with proposal-version and route-revision CAS.",
      tags: ["Session"],
      operationId: "session.executions.routeProposal.decide",
      responses: {
        200: {
          description: "Route proposal decision recorded",
          content: { "application/json": { schema: resolver(RouteDecisionResponse) } },
        },
        ...errors(400, 404, 409, 422),
      },
    }),
    validator("param", ExecutionParam.extend({ proposalID: z.string() })),
    validator(
      "json",
      z.object({
        requestID: RequestID,
        expectedProposalVersion: z.number().int().positive(),
        expectedRouteRevision: z.number().int().positive(),
        decision: z.enum(["accept", "reject"]),
        acceptScope: z.enum(["episode", "execution"]).optional(),
      }),
    ),
    async (c) => {
      const param = c.req.valid("param")
      const body = c.req.valid("json")
      const scope = await rootScope(param.sessionID)
      const result = ExecutionRuntime.decideRouteProposal({
        ...body,
        proposalID: param.proposalID,
        executionID: param.executionID,
        sessionID: scope.sessionID,
        projectID: scope.projectID,
        actorID: "session-user",
      })
      if (!result.decided)
        return c.json(
          {
            error: result.reason,
            version: "version" in result ? result.version : undefined,
            routeRevision: "routeRevision" in result ? result.routeRevision : undefined,
          },
          failureStatus(result.reason),
        )
      return c.json({ requestID: body.requestID, idempotent: result.idempotent, proposal: result.proposal })
    },
  )
