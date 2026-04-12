import { createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createAutoScroll } from "@atomcli/ui/hooks"
import type { UserMessage } from "@atomcli/sdk/v2"
import { useParams } from "@solidjs/router"

export function useSessionScroll(props: {
    visibleUserMessages: () => UserMessage[]
    activeMessageId: () => string | undefined
    setActiveMessageId: (id: string | undefined) => void
    isWorking: () => boolean
    messagesReady: () => boolean
}) {
    const params = useParams()
    const [state, setState] = createStore({
        turnStart: 0,
        promptHeight: 0,
        messageId: undefined as string | undefined, // Internal tracking or sync with prop
    })

    // Sync state.messageId with props.activeMessageId if needed, 
    // currently the prop seems to be the source of truth for "active message" logic
    // but scrollSpy updates it.

    let scroller: HTMLDivElement | undefined
    let promptDock: HTMLDivElement | undefined

    const turnInit = 20
    const turnBatch = 20
    let turnHandle: number | undefined
    let turnIdle = false

    const autoScroll = createAutoScroll({
        working: props.isWorking,
    })

    const setScrollRef = (el: HTMLDivElement | undefined) => {
        scroller = el
        autoScroll.scrollRef(el)
    }

    const setPromptDockRef = (el: HTMLDivElement | undefined) => {
        promptDock = el
    }

    function cancelTurnBackfill() {
        const handle = turnHandle
        if (handle === undefined) return
        turnHandle = undefined

        if (turnIdle && window.cancelIdleCallback) {
            window.cancelIdleCallback(handle)
            return
        }

        clearTimeout(handle)
    }

    function backfillTurns() {
        const start = state.turnStart
        if (start <= 0) return

        const next = start - turnBatch
        const nextStart = next > 0 ? next : 0

        const el = scroller
        if (!el) {
            setState("turnStart", nextStart)
            scheduleTurnBackfill()
            return
        }

        const beforeTop = el.scrollTop
        const beforeHeight = el.scrollHeight

        setState("turnStart", nextStart)

        requestAnimationFrame(() => {
            const delta = el.scrollHeight - beforeHeight
            if (delta) el.scrollTop = beforeTop + delta
        })

        scheduleTurnBackfill()
    }

    function scheduleTurnBackfill() {
        if (turnHandle !== undefined) return
        if (state.turnStart <= 0) return

        if (window.requestIdleCallback) {
            turnIdle = true
            turnHandle = window.requestIdleCallback(() => {
                turnHandle = undefined
                backfillTurns()
            })
            return
        }

        turnIdle = false
        turnHandle = window.setTimeout(() => {
            turnHandle = undefined
            backfillTurns()
        }, 0)
    }

    createEffect(
        on(
            () => [params.id, props.messagesReady()] as const,
            ([id, ready]) => {
                cancelTurnBackfill()
                setState("turnStart", 0)
                if (!id || !ready) return

                const len = props.visibleUserMessages().length
                const start = len > turnInit ? len - turnInit : 0
                setState("turnStart", start)
                scheduleTurnBackfill()
            },
            { defer: true },
        ),
    )

    createResizeObserver(
        () => promptDock,
        ({ height }) => {
            const next = Math.ceil(height)

            if (next === state.promptHeight) return

            const el = scroller
            const stick = el ? el.scrollHeight - el.clientHeight - el.scrollTop < 10 : false

            setState("promptHeight", next)

            if (stick && el) {
                requestAnimationFrame(() => {
                    el.scrollTo({ top: el.scrollHeight, behavior: "auto" })
                })
            }
        },
    )

    const anchor = (id: string) => `message-${id}`

    const updateHash = (id: string) => {
        window.history.replaceState(null, "", `#${anchor(id)}`)
    }

    const renderedUserMessages = createMemo(() => {
        const msgs = props.visibleUserMessages()
        const start = state.turnStart
        if (start <= 0) return msgs
        if (start >= msgs.length) return []
        return msgs.slice(start)
    }, [])

    const scrollToMessage = (message: UserMessage, behavior: ScrollBehavior = "smooth") => {
        props.setActiveMessageId(message.id)

        const msgs = props.visibleUserMessages()
        const index = msgs.findIndex((m) => m.id === message.id)
        if (index !== -1 && index < state.turnStart) {
            setState("turnStart", index)
            scheduleTurnBackfill()

            requestAnimationFrame(() => {
                const el = document.getElementById(anchor(message.id))
                if (el) el.scrollIntoView({ behavior, block: "start" })
            })

            updateHash(message.id)
            return
        }

        const el = document.getElementById(anchor(message.id))
        if (el) el.scrollIntoView({ behavior, block: "start" })
        updateHash(message.id)
    }

    let scrollSpyFrame: number | undefined
    let scrollSpyTarget: HTMLDivElement | undefined

    const getActiveMessageId = (container: HTMLDivElement) => {
        const cutoff = container.scrollTop + 100
        const nodes = container.querySelectorAll<HTMLElement>("[data-message-id]")
        let id: string | undefined

        for (const node of nodes) {
            const next = node.dataset.messageId
            if (!next) continue
            if (node.offsetTop > cutoff) break
            id = next
        }

        return id
    }

    const scheduleScrollSpy = (container: HTMLDivElement) => {
        scrollSpyTarget = container
        if (scrollSpyFrame !== undefined) return

        scrollSpyFrame = requestAnimationFrame(() => {
            scrollSpyFrame = undefined

            const target = scrollSpyTarget
            scrollSpyTarget = undefined
            if (!target) return

            const id = getActiveMessageId(target)
            if (!id) return
            if (id === props.activeMessageId()) return

            props.setActiveMessageId(id)
        })
    }

    // Handle hash scrolling on load
    createEffect(() => {
        const sessionID = params.id
        const ready = props.messagesReady()
        if (!sessionID || !ready) return

        requestAnimationFrame(() => {
            const hash = window.location.hash.slice(1)
            if (!hash) {
                autoScroll.forceScrollToBottom()
                return
            }

            const hashTarget = document.getElementById(hash)
            if (hashTarget) {
                hashTarget.scrollIntoView({ behavior: "auto", block: "start" })
                return
            }

            const match = hash.match(/^message-(.+)$/)
            if (match) {
                const msg = props.visibleUserMessages().find((m) => m.id === match[1])
                if (msg) {
                    scrollToMessage(msg, "auto")
                    return
                }
            }

            autoScroll.forceScrollToBottom()
        })
    })

    // Expose turnStart for navigation logic if needed
    const turnStart = () => state.turnStart
    const promptHeight = () => state.promptHeight

    const resetTurnStart = () => {
        setState("turnStart", 0)
    }

    return {
        setScrollRef,
        setPromptDockRef,
        scrollToMessage,
        scheduleScrollSpy,
        renderedUserMessages,
        turnStart,
        resetTurnStart,
        promptHeight,
        autoScroll
    }
}
