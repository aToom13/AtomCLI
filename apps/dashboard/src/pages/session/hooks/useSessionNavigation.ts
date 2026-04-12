import { createMemo, type Accessor } from "solid-js"
import type { UserMessage } from "@atomcli/sdk/v2"
import type { useSessionScroll } from "./useSessionScroll"

export function useSessionNavigation(props: {
    visibleUserMessages: Accessor<UserMessage[]>
    messageId: Accessor<string | undefined>
    scroll: ReturnType<typeof useSessionScroll>
}) {
    const activeMessage = createMemo(() => {
        const id = props.messageId()
        const msgs = props.visibleUserMessages()
        if (!id) return msgs.at(-1)
        return msgs.find((m) => m.id === id) ?? msgs.at(-1)
    })

    const lastUserMessage = createMemo(() => props.visibleUserMessages().at(-1))

    function navigateMessageByOffset(offset: number) {
        const msgs = props.visibleUserMessages()
        if (msgs.length === 0) return

        const current = activeMessage()
        const currentIndex = current ? msgs.findIndex((m) => m.id === current.id) : -1

        let targetIndex: number
        if (currentIndex === -1) {
            targetIndex = offset > 0 ? 0 : msgs.length - 1
        } else {
            targetIndex = currentIndex + offset
        }

        if (targetIndex < 0 || targetIndex >= msgs.length) return

        props.scroll.scrollToMessage(msgs[targetIndex], "auto")
    }

    return {
        activeMessage,
        lastUserMessage,
        navigateMessageByOffset,
    }
}
