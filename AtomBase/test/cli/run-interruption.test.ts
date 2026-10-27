import "../preload"
import { expect, spyOn, test } from "bun:test"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { Identifier } from "@/core/id/id"
import { Session } from "@/core/session"
import { RunCommand } from "@/interfaces/cli/cmd/run"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

test("noninteractive run rejects review retry permission without waiting for a responder", async () => {
  await using project = await tmpdir()
  await Instance.provide({
    directory: project.path,
    fn: async () => {
      const root = await Session.create({})
      const permissionID = Identifier.ascending("permission")
      let stream: ReadableStreamDefaultController<Uint8Array>
      const responses: unknown[] = []
      const emit = (type: string, properties: unknown) =>
        stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type, properties })}\n\n`))
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: async (request) => {
          const route = new URL(request.url).pathname
          if (route === "/config") return Response.json({})
          if (route === "/event")
            return new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  stream = controller
                  emit("server.connected", {})
                },
              }),
              { headers: { "Content-Type": "text/event-stream" } },
            )
          if (route.endsWith("/prompt_async")) {
            emit("permission.asked", {
              id: permissionID,
              sessionID: root.id,
              permission: "review.retry",
              patterns: ["candidate"],
              always: [],
              metadata: {},
            })
            return new Response(null, { status: 204 })
          }
          if (route.endsWith(`/permissions/${permissionID}`)) {
            responses.push(await request.json())
            emit("session.status", { sessionID: root.id, status: { type: "idle" } })
            return Response.json(true)
          }
          return new Response(null, { status: 404 })
        },
      })
      const stdin = spyOn(Bun.stdin, "text").mockResolvedValue("")
      try {
        await RunCommand.handler({
          message: ["Check"],
          attach: server.url.origin,
          session: root.id,
          format: "json",
        } as never)
        expect(responses).toEqual([{ response: "reject" }])
      } finally {
        stdin.mockRestore()
        server.stop(true)
      }
    },
  })
})

test("CLI stream EOF cancels its exact execution rather than returning success", async () => {
  await using project = await tmpdir()
  await Instance.provide({
    directory: project.path,
    fn: async () => {
      const root = await Session.create({})
      let execution: ExecutionRuntime.Context
      let newer: ExecutionRuntime.Context
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: async (request) =>
          Instance.provide({
            directory: project.path,
            fn: async () => {
              const route = new URL(request.url).pathname
              if (route === "/event")
                return new Response('data: {"type":"server.connected","properties":{}}\n\n', {
                  headers: { "Content-Type": "text/event-stream" },
                })
              if (route.endsWith("/prompt_async")) {
                const input = await request.json()
                execution = await ExecutionRuntime.resolveInvocation({
                  sessionID: root.id,
                  invocationID: input.messageID,
                  acceptedMessageID: input.messageID,
                })
                newer = await ExecutionRuntime.resolveInvocation({
                  sessionID: root.id,
                  invocationID: Identifier.ascending("message"),
                })
                return new Response(null, { status: 204 })
              }
              if (route.endsWith("/execution-snapshot")) return Response.json(ExecutionRuntime.snapshot(root.id))
              if (route.endsWith("/cancel")) {
                const input = await request.json()
                expect(route).toContain(encodeURIComponent(execution.executionID))
                expect(input.expectedVersion).toBe(ExecutionRuntime.view(execution.executionID)!.version)
                ExecutionRuntime.cancelExecution(execution)
                return Response.json({ cancelled: true })
              }
              return new Response(null, { status: 404 })
            },
          }),
      })
      const stdin = spyOn(Bun.stdin, "text").mockResolvedValue("")
      try {
        await expect(
          RunCommand.handler({
            message: ["Check"],
            attach: server.url.origin,
            session: root.id,
            format: "json",
          } as never),
        ).rejects.toThrow("Session event stream ended before completion")
        expect(ExecutionRuntime.view(execution.executionID)).toMatchObject({
          lifecycle: "terminal",
          outcome: "cancelled",
        })
        expect(ExecutionRuntime.view(newer.executionID)?.lifecycle).toBe("active")
      } finally {
        stdin.mockRestore()
        server.stop(true)
      }
    },
  })
})
