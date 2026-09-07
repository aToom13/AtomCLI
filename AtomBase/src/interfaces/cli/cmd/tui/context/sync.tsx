import type {
  Message,
  Agent,
  Provider,
  Session,
  Part,
  Config,
  Todo,
  Command,
  PermissionRequest,
  QuestionRequest,
  LspStatus,
  McpStatus,
  McpResource,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  VcsInfo,
  SessionExecutionsSnapshotResponse,
} from "@atomcli/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useSDK } from "@tui/context/sdk"
import { Binary } from "@atomcli/util/binary"
import { createSimpleContext } from "./helper"
import type { Snapshot } from "@/core/snapshot"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, onMount } from "solid-js"
import { Log } from "@/util/util/log"
import type { Path } from "@atomcli/sdk/v2"

export type DeliveryRecord = {
  sessionID: string
  state: "sending" | "sent" | "failed" | "unknown"
  draft: { input: string; mode?: "normal" | "shell"; parts: any[] }
  error?: string
  updatedAt: number
}

import { handleSessionEvent } from "./handlers/session"
import { handleMessageEvent } from "./handlers/message"
import { handlePartEvent } from "./handlers/part"
import { handlePermissionEvent } from "./handlers/permission"

import { createActor } from "xstate"
import { chatMachine } from "./machine/chat"

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      provider: Provider[]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      provider_auth: Record<string, ProviderAuthMethod[]>
      agent: Agent[]
      command: Command[]
      permission: {
        [sessionID: string]: PermissionRequest[]
      }
      question: {
        [sessionID: string]: QuestionRequest[]
      }
      config: Config
      session: Session[]
      session_status: {
        [sessionID: string]: SessionStatus
      }
      execution_snapshot: {
        [sessionID: string]: SessionExecutionsSnapshotResponse
      }
      route_proposals: { [sessionID: string]: SessionExecutionsSnapshotResponse["pendingProposals"] }
      session_diff: {
        [sessionID: string]: Snapshot.FileDiff[]
      }
      todo: {
        [sessionID: string]: Todo[]
      }
      message: {
        [sessionID: string]: Message[]
      }
      optimistic_message: {
        [sessionID: string]: Message[]
      }
      delivery: {
        [messageID: string]: DeliveryRecord
      }
      part: {
        [messageID: string]: Part[]
      }
      lsp: LspStatus[]
      mcp: {
        [key: string]: McpStatus
      }
      mcp_resource: {
        [key: string]: McpResource
      }
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
      path: Path
    }>({
      provider_next: {
        all: [],
        default: {},
        connected: [],
      },
      provider_auth: {},
      config: {},
      status: "loading",
      agent: [],
      permission: {},
      question: {},
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      session_status: {},
      execution_snapshot: {},
      route_proposals: {},
      session_diff: {},
      todo: {},
      message: {},
      optimistic_message: {},
      delivery: {},
      part: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
      path: { home: "", state: "", config: "", worktree: "", directory: "" },
    })

    const sdk = useSDK()
    const fullSyncedSessions = new Set<string>()
    const inflightSyncs = new Map<string, Promise<void>>()
    let syncGeneration = 0

    const invalidateSessionSync = () => {
      syncGeneration++
      fullSyncedSessions.clear()
      inflightSyncs.clear()
    }

    const actor = createActor(chatMachine, {
      input: { store, setStore },
    }).start()

    sdk.event.listen((e) => {
      const event = e.details
      if (
        event.type.startsWith("session.") ||
        event.type.startsWith("message.") ||
        event.type.startsWith("permission.") ||
        event.type.startsWith("question.")
      ) {
        actor.send({ type: event.type, payload: event })
        return
      }

      switch (event.type) {
        case "server.instance.disposed":
          invalidateSessionSync()
          bootstrap()
          break
        case "server.connected":
        case "server.resync_required":
          invalidateSessionSync()
          bootstrap()
          break
        case "config.updated": {
          // Config updated from server - refresh local store
          setStore("config", reconcile(event.properties.config))
          break
        }
        case "todo.updated":
          setStore("todo", event.properties.sessionID, event.properties.todos)
          break

        case "execution.route.proposal": {
          const properties = event.properties as any
          setStore(
            produce((draft) => {
              const proposals = (draft.route_proposals[properties.sessionID] ??= [])
              const index = proposals.findIndex((proposal) => proposal.id === properties.proposal.id)
              if (index >= 0 && proposals[index].version > properties.proposal.version) return
              if (index >= 0) proposals[index] = properties.proposal
              else proposals.push(properties.proposal)
              if (proposals.length > 100) proposals.splice(0, proposals.length - 100)
              const snapshot = draft.execution_snapshot[properties.sessionID]
              if (snapshot)
                snapshot.pendingProposals = proposals.filter((p) => ["pending", "accepted"].includes(p.state))
            }),
          )
          break
        }

        case "execution.route.changed": {
          const properties = event.properties as any
          const snapshot = store.execution_snapshot[properties.sessionID]
          const execution = snapshot?.executions.find((item) => item.id === properties.executionID)
          if (execution)
            setStore("execution_snapshot", properties.sessionID, "executions", (item) => item.id === execution.id, {
              ...execution,
              routeRevision: properties.routeRevision,
              route: execution.route
                ? {
                    ...execution.route,
                    active: properties.route,
                    stage: properties.stage,
                  }
                : execution.route,
            })
          break
        }

        case "lsp.updated": {
          sdk.client.lsp.status().then((x) => setStore("lsp", x.data!))
          break
        }

        case "vcs.branch.updated": {
          setStore("vcs", { branch: event.properties.branch })
          break
        }
      }
    })

    const exit = useExit()
    const args = useArgs()

    async function bootstrap() {
      Log.Default.debug("bootstrapping")
      const start = Date.now() - 30 * 24 * 60 * 60 * 1000
      const sessionListPromise = sdk.client.session
        .list({ start: start })
        .then((x) => setStore("session", reconcile((x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))))

      // blocking - include session.list when continuing a session
      const blockingRequests: Promise<unknown>[] = [
        sdk.client.config.providers({}, { throwOnError: true }).then((x) => {
          batch(() => {
            setStore("provider", reconcile(x.data!.providers))
            setStore("provider_default", reconcile(x.data!.default))
          })
        }),
        sdk.client.provider.list({}, { throwOnError: true }).then((x) => {
          batch(() => {
            setStore("provider_next", reconcile(x.data!))
          })
        }),
        sdk.client.app.agents({}, { throwOnError: true }).then((x) => setStore("agent", reconcile(x.data ?? []))),
        sdk.client.config.get({}, { throwOnError: true }).then((x) => setStore("config", reconcile(x.data!))),
        ...(args.continue ? [sessionListPromise] : []),
      ]

      await Promise.all(blockingRequests)
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")
          // non-blocking
          Promise.all([
            ...(args.continue ? [] : [sessionListPromise]),
            sdk.client.command.list().then((x) => setStore("command", reconcile(x.data ?? []))),
            sdk.client.lsp.status().then((x) => setStore("lsp", reconcile(x.data!))),
            sdk.client.mcp.status().then((x) => setStore("mcp", reconcile(x.data!))),
            sdk.client.mcp.resource.list().then((x) => setStore("mcp_resource", reconcile(x.data ?? {}))),
            sdk.client.formatter.status().then((x) => setStore("formatter", reconcile(x.data!))),
            sdk.client.session.status().then((x) => {
              setStore("session_status", reconcile(x.data!))
            }),
            sdk.client.provider.auth().then((x) => setStore("provider_auth", reconcile(x.data ?? {}))),
            sdk.client.vcs.get().then((x) => setStore("vcs", reconcile(x.data))),
            sdk.client.path.get().then((x) => setStore("path", reconcile(x.data!))),
          ]).then(() => {
            setStore("status", "complete")
          })
        })
        .catch(async (e) => {
          Log.Default.error("tui bootstrap failed", {
            error: e instanceof Error ? e.message : String(e),
            name: e instanceof Error ? e.name : undefined,
            stack: e instanceof Error ? e.stack : undefined,
          })
          await exit(e)
        })
    }

    onMount(() => {
      bootstrap()
    })

    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        return store.status !== "loading"
      },
      session: {
        get(sessionID: string) {
          const match = Binary.search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        status(sessionID: string) {
          const session = result.session.get(sessionID)
          if (!session) return "idle"
          if (session.time.compacting) return "compacting"
          const messages = store.message[sessionID] ?? []
          const last = messages.at(-1)
          if (!last) return "idle"
          if (last.role === "user") return "working"
          return last.time.completed ? "idle" : "working"
        },
        async sync(sessionID: string) {
          if (fullSyncedSessions.has(sessionID)) return
          const inflight = inflightSyncs.get(sessionID)
          if (inflight) return inflight

          const request = (async () => {
            const generation = syncGeneration
            const [session, messages, todo, diff, executionSnapshot] = await Promise.all([
              sdk.client.session.get({ sessionID }, { throwOnError: true }),
              sdk.client.session.messages({ sessionID, limit: 100 }),
              sdk.client.session.todo({ sessionID }),
              sdk.client.session.diff({ sessionID }),
              sdk.client.session.executions.snapshot({ sessionID }),
            ])
            if (generation !== syncGeneration) return
            setStore(
              produce((draft) => {
                const match = Binary.search(draft.session, sessionID, (s) => s.id)
                if (match.found) draft.session[match.index] = session.data!
                if (!match.found) draft.session.splice(match.index, 0, session.data!)
                draft.todo[sessionID] = todo.data ?? []
                draft.message[sessionID] = messages.data!.map((x) => x.info)
                for (const message of messages.data!) {
                  draft.part[message.info.id] = message.parts
                }
                draft.session_diff[sessionID] = diff.data ?? []
                if (executionSnapshot.data) draft.execution_snapshot[sessionID] = executionSnapshot.data
                const proposals = (draft.route_proposals[sessionID] ??= [])
                for (const proposal of executionSnapshot.data?.pendingProposals ?? []) {
                  const index = proposals.findIndex((item) => item.id === proposal.id)
                  if (index < 0) proposals.push(proposal)
                  else if (proposals[index].version < proposal.version) proposals[index] = proposal
                }
              }),
            )
            if (generation === syncGeneration) fullSyncedSessions.add(sessionID)
          })()
          inflightSyncs.set(sessionID, request)
          try {
            await request
          } finally {
            inflightSyncs.delete(sessionID)
          }
        },
      },
      optimistic: {
        push(sessionID: string, msg: Message, parts: Part[], deliveryDraft: DeliveryRecord["draft"]) {
          setStore(
            produce((draft) => {
              if (!draft.optimistic_message[sessionID]) {
                draft.optimistic_message[sessionID] = []
              }
              draft.optimistic_message[sessionID].push(msg)
              draft.part[msg.id] = parts
              draft.delivery[msg.id] = {
                sessionID,
                state: "sending",
                draft: deliveryDraft,
                updatedAt: Date.now(),
              }
              while (draft.optimistic_message[sessionID].length > 100) {
                const evicted = draft.optimistic_message[sessionID].shift()
                if (!evicted) continue
                delete draft.part[evicted.id]
                delete draft.delivery[evicted.id]
              }
            }),
          )
        },
        clear(sessionID: string) {
          setStore(
            produce((draft) => {
              for (const message of draft.optimistic_message[sessionID] ?? []) {
                delete draft.part[message.id]
                delete draft.delivery[message.id]
              }
              draft.optimistic_message[sessionID] = []
            }),
          )
        },
        settle(messageID: string, state: "sent" | "failed" | "unknown", error?: string) {
          setStore(
            produce((draft) => {
              const delivery = draft.delivery[messageID]
              if (!delivery || delivery.state === "sent") return
              delivery.state = state
              delivery.error = error
              delivery.updatedAt = Date.now()
            }),
          )
        },
        recover(messageID: string) {
          const delivery = store.delivery[messageID]
          if (!delivery || !["failed", "unknown"].includes(delivery.state)) return
          setStore(
            produce((draft) => {
              const messages = draft.optimistic_message[delivery.sessionID] ?? []
              const index = messages.findIndex((message) => message.id === messageID)
              if (index >= 0) messages.splice(index, 1)
              delete draft.part[messageID]
              delete draft.delivery[messageID]
            }),
          )
          return delivery.draft
        },
      },
      bootstrap,
    }
    return result
  },
})
