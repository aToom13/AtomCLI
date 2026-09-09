import { describe, expect, test } from "bun:test"
import "../preload"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { Session } from "@/core/session"
import { Server } from "@/server/server"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("session execution API", () => {
  test("exposes and reconciles unknown mutating work", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const execution = await ExecutionRuntime.resolveInvocation({
          sessionID: session.id,
          invocationID: "msg_execution_recovery",
          kind: "root",
        })
        const registered = await ExecutionRuntime.registerWork({
          sessionID: session.id,
          execution,
          operationID: "operation-recovery",
          kind: "tool:write",
          mutating: true,
        })
        const began = await ExecutionRuntime.beginWork({
          sessionID: session.id,
          execution,
          operationID: "operation-recovery",
          expectedVersion: registered.version,
        })
        await ExecutionRuntime.finishWork({
          sessionID: session.id,
          execution,
          operationID: "operation-recovery",
          expectedVersion: began.version,
          state: "unknown",
        })

        const query = `directory=${encodeURIComponent(tmp.path)}`
        const app = Server.App()
        const snapshot = (await (await app.request(`/session/${session.id}/execution-snapshot?${query}`)).json()) as any
        const item = snapshot.executions.find((candidate: any) => candidate.id === execution.executionID)
        expect(item.unknownWork).toEqual([
          expect.objectContaining({ id: "operation-recovery", version: began.version + 1, mutating: true }),
        ])

        const response = await app.request(
          `/session/${session.id}/executions/${encodeURIComponent(execution.executionID)}/reconcile?${query}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              requestID: "reconcile-api-1",
              operationID: "operation-recovery",
              state: "cancelled",
              expectedVersion: item.version,
              expectedWorkVersion: began.version + 1,
              evidence: "User confirmed operation operation-recovery was not applied or was cancelled.",
              resolutionCode: "user_confirmed_not_applied",
            }),
          },
        )
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({ execution: { unknownWork: [] } })
        await Session.remove(session.id)
      },
    })
  })

  test("scopes list, detail, snapshot, replay and idempotent cancellation to the session project", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const foreign = await Session.create({})
        const execution = await ExecutionRuntime.resolveInvocation({
          sessionID: session.id,
          invocationID: "msg_execution_api",
          kind: "root",
          acceptedMessageID: "msg_execution_api",
        })
        const query = `directory=${encodeURIComponent(tmp.path)}`
        const app = Server.App()

        const listResponse = await app.request(`/session/${session.id}/executions?${query}`)
        expect(listResponse.status).toBe(200)
        const list = (await listResponse.json()) as any
        expect(list.items).toHaveLength(1)
        expect(list.items[0]).toMatchObject({ id: execution.executionID, lifecycle: "active", outcome: null })

        const detailResponse = await app.request(
          `/session/${session.id}/executions/${encodeURIComponent(execution.executionID)}?${query}`,
        )
        expect(detailResponse.status).toBe(200)
        const detail = (await detailResponse.json()) as any
        expect(detail.id).toBe(execution.executionID)

        const foreignResponse = await app.request(
          `/session/${foreign.id}/executions/${encodeURIComponent(execution.executionID)}?${query}`,
        )
        expect(foreignResponse.status).toBe(404)

        const snapshotResponse = await app.request(`/session/${session.id}/execution-snapshot?${query}`)
        expect(snapshotResponse.status).toBe(200)
        const snapshot = (await snapshotResponse.json()) as any
        expect(snapshot.activeExecutionID).toBe(execution.executionID)
        expect(snapshot.activeInvocations).toEqual([
          expect.objectContaining({ id: "msg_execution_api", executionID: execution.executionID }),
        ])

        const replayResponse = await app.request(
          `/session/${session.id}/execution-events?epoch=obsolete&sequence=0&${query}`,
        )
        expect(replayResponse.status).toBe(200)
        expect(await replayResponse.json()).toMatchObject({ resyncRequired: true, reason: "epoch_changed" })

        const staleCancel = await app.request(
          `/session/${session.id}/executions/${encodeURIComponent(execution.executionID)}/cancel?${query}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ requestID: "cancel-api-stale", expectedVersion: detail.version + 1 }),
          },
        )
        expect(staleCancel.status).toBe(409)

        const cancelBody = { requestID: "cancel-api-1", expectedVersion: detail.version }
        const cancel = await app.request(
          `/session/${session.id}/executions/${encodeURIComponent(execution.executionID)}/cancel?${query}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(cancelBody),
          },
        )
        expect(cancel.status).toBe(202)
        expect(await cancel.json()).toMatchObject({
          requestID: "cancel-api-1",
          idempotent: false,
          execution: { outcome: "cancelled", lifecycle: "terminal" },
        })

        const duplicate = await app.request(
          `/session/${session.id}/executions/${encodeURIComponent(execution.executionID)}/cancel?${query}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(cancelBody),
          },
        )
        expect(duplicate.status).toBe(202)
        expect(await duplicate.json()).toMatchObject({ requestID: "cancel-api-1", idempotent: true })

        await Session.remove(session.id)
        await Session.remove(foreign.id)
      },
    })
  })
})
