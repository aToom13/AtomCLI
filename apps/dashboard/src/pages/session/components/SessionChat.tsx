import { type Accessor, For, Show } from "solid-js"
import { useParams } from "@solidjs/router"
import { Button } from "@atomcli/ui/button"
import { SessionTurn } from "@atomcli/ui/session-turn"
import { SessionMessageRail } from "@atomcli/ui/session-message-rail"
import { usePlatform } from "@atomcli/ui/hooks/platform"
import type { UserMessage } from "@atomcli/sdk/v2"
import type { useSessionScroll } from "../hooks/useSessionScroll"

interface SessionChatProps {
    scroll: ReturnType<typeof useSessionScroll>
    isDesktop: () => boolean
    showTabs: () => boolean

    // Expanded steps state
    expanded: Record<string, boolean>
    setExpanded: (id: string, toggle: (prev: boolean) => boolean) => void

    // History
    historyMore: Accessor<boolean>
    historyLoading: Accessor<boolean>
    onLoadHistory: (id: string) => void

    // Data
    visibleUserMessages: Accessor<UserMessage[]>
    activeMessage: Accessor<UserMessage | undefined>
    lastUserMessage: Accessor<UserMessage | undefined>
}

export function SessionChat(props: SessionChatProps) {
    const params = useParams()
    const platform = usePlatform()

    return (
        <div class="relative w-full h-full min-w-0">
            <Show when={props.isDesktop()}>
                <div class="absolute inset-0 pointer-events-none z-10">
                    <SessionMessageRail
                        messages={props.visibleUserMessages()}
                        current={props.activeMessage()}
                        onMessageSelect={props.scroll.scrollToMessage}
                        wide={!props.showTabs()}
                        class="pointer-events-auto"
                    />
                </div>
            </Show>
            <div
                ref={props.scroll.setScrollRef}
                onScroll={(e) => {
                    props.scroll.autoScroll.handleScroll()
                    if (props.isDesktop()) props.scroll.scheduleScrollSpy(e.currentTarget)
                }}
                onClick={props.scroll.autoScroll.handleInteraction}
                class="relative min-w-0 w-full h-full overflow-y-auto no-scrollbar"
            >
                <div
                    ref={props.scroll.autoScroll.contentRef}
                    class="flex flex-col gap-32 items-start justify-start pb-[calc(var(--prompt-height,8rem)+64px)] md:pb-[calc(var(--prompt-height,10rem)+64px)] transition-[margin]"
                    classList={{
                        "mt-0.5": !props.showTabs(),
                        "mt-0": props.showTabs(),
                    }}
                >
                    <Show when={props.scroll.turnStart() > 0}>
                        <div class="w-full flex justify-center">
                            <Button
                                variant="ghost"
                                size="large"
                                class="text-12-medium opacity-50"
                                onClick={() => props.scroll.resetTurnStart()}
                            >
                                Render earlier messages
                            </Button>
                        </div>
                    </Show>
                    <Show when={props.historyMore()}>
                        <div class="w-full flex justify-center">
                            <Button
                                variant="ghost"
                                size="large"
                                class="text-12-medium opacity-50"
                                disabled={props.historyLoading()}
                                onClick={() => {
                                    if (!params.id) return
                                    props.onLoadHistory(params.id)
                                }}
                            >
                                {props.historyLoading() ? "Loading earlier messages..." : "Load earlier messages"}
                            </Button>
                        </div>
                    </Show>
                    <For each={props.scroll.renderedUserMessages()}>
                        {(message) => (
                            <div
                                id={`message-${message.id}`}
                                data-message-id={message.id}
                                classList={{
                                    "min-w-0 w-full max-w-full": true,
                                    "last:min-h-[calc(100vh-5.5rem-var(--prompt-height,8rem)-64px)] md:last:min-h-[calc(100vh-4.5rem-var(--prompt-height,10rem)-64px)]":
                                        platform.platform !== "desktop",
                                    "last:min-h-[calc(100vh-7rem-var(--prompt-height,8rem)-64px)] md:last:min-h-[calc(100vh-6rem-var(--prompt-height,10rem)-64px)]":
                                        platform.platform === "desktop",
                                }}
                            >
                                <SessionTurn
                                    sessionID={params.id!}
                                    messageID={message.id}
                                    lastUserMessageID={props.lastUserMessage()?.id}
                                    stepsExpanded={props.expanded[message.id] ?? false}
                                    onStepsExpandedToggle={() =>
                                        props.setExpanded(message.id, (open: boolean) => !open)
                                    }
                                    classes={{
                                        root: "min-w-0 w-full relative",
                                        content:
                                            "flex flex-col justify-between !overflow-visible [&_[data-slot=session-turn-message-header]]:top-[-32px]",
                                        container:
                                            "px-4 md:px-6 " +
                                            (!props.showTabs()
                                                ? "md:max-w-200 md:mx-auto"
                                                : props.visibleUserMessages().length > 1
                                                    ? "md:pr-6 md:pl-18"
                                                    : ""),
                                    }}
                                />
                            </div>
                        )}
                    </For>
                </div>
            </div>
        </div>
    )
}
