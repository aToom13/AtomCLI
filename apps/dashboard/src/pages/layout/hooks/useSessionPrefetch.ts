import { batch, createEffect } from "solid-js"
import { reconcile } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { retry } from "@atomcli/util/retry"
import { Session } from "@atomcli/sdk/v2/client"

type PrefetchQueue = {
    inflight: Set<string>
    pending: string[]
    pendingSet: Set<string>
    running: number
}

export function useSessionPrefetch(sessions: () => Session[]) {
    const params = useParams()
    const globalSDK = useGlobalSDK()
    const globalSync = useGlobalSync()

    const prefetchChunk = 200
    const prefetchConcurrency = 1
    const prefetchPendingLimit = 6
    const prefetchToken = { value: 0 }
    const prefetchQueues = new Map<string, PrefetchQueue>()

    createEffect(() => {
        params.dir
        globalSDK.url

        prefetchToken.value += 1
        for (const q of prefetchQueues.values()) {
            q.pending.length = 0
            q.pendingSet.clear()
        }
    })

    const queueFor = (directory: string) => {
        const existing = prefetchQueues.get(directory)
        if (existing) return existing

        const created: PrefetchQueue = {
            inflight: new Set(),
            pending: [],
            pendingSet: new Set(),
            running: 0,
        }
        prefetchQueues.set(directory, created)
        return created
    }

    const prefetchMessages = (directory: string, sessionID: string, token: number) => {
        const [, setStore] = globalSync.child(directory)

        return retry(() => globalSDK.client.session.messages({ directory, sessionID, limit: prefetchChunk }))
            .then((messages) => {
                if (prefetchToken.value !== token) return

                const items = (messages.data ?? []).filter((x) => !!x?.info?.id)
                const next = items
                    .map((x) => x.info)
                    .filter((m) => !!m?.id)
                    .slice()
                    .sort((a, b) => a.id.localeCompare(b.id))

                batch(() => {
                    setStore("message", sessionID, reconcile(next, { key: "id" }))

                    for (const message of items) {
                        setStore(
                            "part",
                            message.info.id,
                            reconcile(
                                message.parts
                                    .filter((p) => !!p?.id)
                                    .slice()
                                    .sort((a, b) => a.id.localeCompare(b.id)),
                                { key: "id" },
                            ),
                        )
                    }
                })
            })
            .catch(() => undefined)
    }

    const pumpPrefetch = (directory: string) => {
        const q = queueFor(directory)
        if (q.running >= prefetchConcurrency) return

        const sessionID = q.pending.shift()
        if (!sessionID) return

        q.pendingSet.delete(sessionID)
        q.inflight.add(sessionID)
        q.running += 1

        const token = prefetchToken.value

        void prefetchMessages(directory, sessionID, token).finally(() => {
            q.running -= 1
            q.inflight.delete(sessionID)
            pumpPrefetch(directory)
        })
    }

    const prefetchSession = (session: Session, priority: "high" | "low" = "low") => {
        const directory = session.directory
        if (!directory) return

        const [store] = globalSync.child(directory)
        if (store.message[session.id] !== undefined) return

        const q = queueFor(directory)
        if (q.inflight.has(session.id)) return
        if (q.pendingSet.has(session.id)) return

        if (priority === "high") q.pending.unshift(session.id)
        if (priority !== "high") q.pending.push(session.id)
        q.pendingSet.add(session.id)

        while (q.pending.length > prefetchPendingLimit) {
            const dropped = q.pending.pop()
            if (!dropped) continue
            q.pendingSet.delete(dropped)
        }

        pumpPrefetch(directory)
    }

    createEffect(() => {
        const list = sessions()
        const id = params.id

        if (!id) {
            const first = list[0]
            if (first) prefetchSession(first)

            const second = list[1]
            if (second) prefetchSession(second)
            return
        }

        const index = list.findIndex((s) => s.id === id)
        if (index === -1) return

        const next = list[index + 1]
        if (next) prefetchSession(next)

        const prev = list[index - 1]
        if (prev) prefetchSession(prev)
    })

    return { prefetchSession }
}
