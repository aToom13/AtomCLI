import { For, Show, createMemo, createSignal } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { StatusIcons, type AgentChain, type ChainStep, type StepTodo } from "@/agent/chain"

/**
 * Task Chain Progress Bar - Minimal dot indicator at top of screen
 * 
 * Design:
 * - Always visible bar at top
 * - Shows dots (●) for each step
 * - Green = complete, Yellow = current, Gray = pending, Red = failed
 * - Click to expand full task list
 * - Click on a step to see its todos
 */
export function ChainProgressBar(props: { chain: AgentChain | null }) {
    const { theme } = useTheme()
    const [expanded, setExpanded] = createSignal(false)
    const [selectedStep, setSelectedStep] = createSignal<number | null>(null)

    const totalSteps = createMemo(() => props.chain?.steps.length ?? 0)
    const completedSteps = createMemo(() =>
        props.chain?.steps.filter((s) => s.status === "complete").length ?? 0
    )
    const hasError = createMemo(() =>
        props.chain?.steps.some((s) => s.status === "failed") ?? false
    )

    const selectedStepTodos = createMemo(() => {
        const idx = selectedStep()
        if (idx === null || !props.chain) return []
        return props.chain.steps[idx]?.todos ?? []
    })

    return (
        <Show when={props.chain && totalSteps() > 0}>
            <box flexDirection="column">
                {/* Progress Bar - Always Visible */}
                <box
                    flexDirection="row"
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={theme.backgroundPanel}
                    gap={1}
                    onMouseUp={() => setExpanded((prev) => !prev)}
                >
                    <text fg={theme.textMuted}>📋</text>

                    {/* Dots */}
                    <box flexDirection="row" gap={0}>
                        <For each={props.chain!.steps}>
                            {(step, i) => {
                                const dotColor = createMemo(() => {
                                    if (step.status === "complete") return theme.success
                                    if (step.status === "failed") return theme.error
                                    if (step.status === "retrying") return theme.warning
                                    if (i() === props.chain!.currentStep) return theme.accent
                                    return theme.textMuted
                                })

                                const dot = createMemo(() => {
                                    if (step.status === "complete") return "●"
                                    if (step.status === "failed") return "●"
                                    if (i() === props.chain!.currentStep) return "◉"
                                    return "○"
                                })

                                return <text fg={dotColor()}>{dot()}</text>
                            }}
                        </For>
                    </box>

                    {/* Status summary */}
                    <text fg={theme.textMuted}>
                        ({completedSteps()}/{totalSteps()})
                    </text>

                    <Show when={hasError()}>
                        <text fg={theme.error}>❌</text>
                    </Show>

                    <text fg={theme.textMuted}>
                        {expanded() ? "▲" : "▼"}
                    </text>
                </box>

                {/* Expanded Task List */}
                <Show when={expanded()}>
                    <box
                        flexDirection="row"
                        backgroundColor={theme.backgroundMenu}
                        border={["bottom"]}
                        borderColor={theme.borderActive}
                    >
                        {/* Left: Step List */}
                        <box
                            flexDirection="column"
                            paddingLeft={2}
                            paddingRight={2}
                            paddingTop={1}
                            paddingBottom={1}
                            flexGrow={1}
                        >
                            <For each={props.chain!.steps}>
                                {(step, i) => (
                                    <ChainStepRow
                                        step={step}
                                        index={i()}
                                        isCurrent={i() === props.chain!.currentStep}
                                        isSelected={selectedStep() === i()}
                                        onClick={() => setSelectedStep(selectedStep() === i() ? null : i())}
                                    />
                                )}
                            </For>
                        </box>

                        {/* Right: Todo List for Selected Step */}
                        <Show when={selectedStep() !== null && selectedStepTodos().length > 0}>
                            <box
                                flexDirection="column"
                                paddingLeft={2}
                                paddingRight={2}
                                paddingTop={1}
                                paddingBottom={1}
                                flexGrow={1}
                                border={["left"]}
                                borderColor={theme.border}
                            >
                                <text fg={theme.accent}>
                                    📝 Todos: {props.chain!.steps[selectedStep()!]?.name}
                                </text>
                                <For each={selectedStepTodos()}>
                                    {(todo) => <TodoItem todo={todo} />}
                                </For>
                            </box>
                        </Show>

                        {/* Show hint if no step selected */}
                        <Show when={selectedStep() === null}>
                            <box
                                paddingLeft={2}
                                paddingTop={1}
                                flexGrow={1}
                            >
                                <text fg={theme.textMuted}>
                                    ← Adıma tıkla todo görmek için
                                </text>
                            </box>
                        </Show>
                    </box>
                </Show>
            </box>
        </Show>
    )
}

function ChainStepRow(props: {
    step: ChainStep
    index: number
    isCurrent: boolean
    isSelected: boolean
    onClick: () => void
}) {
    const { theme } = useTheme()

    const color = createMemo(() => {
        if (props.step.status === "complete") return theme.success
        if (props.step.status === "failed") return theme.error
        if (props.step.status === "retrying") return theme.warning
        if (props.isCurrent) return theme.accent
        return theme.textMuted
    })

    const icon = createMemo(() => StatusIcons[props.step.status] ?? "⏳")
    const hasTodos = createMemo(() => (props.step.todos?.length ?? 0) > 0)

    return (
        <box onMouseUp={props.onClick}>
            <text fg={color()}>
                {props.isSelected ? "▶ " : "  "}
                {props.index + 1}. {icon()} {props.step.name}
                <Show when={hasTodos()}>
                    <span style={{ fg: theme.textMuted }}> [{props.step.todos?.length}]</span>
                </Show>
                <Show when={props.step.retryCount > 0}>
                    <span style={{ fg: theme.warning }}> (retry {props.step.retryCount})</span>
                </Show>
            </text>
        </box>
    )
}

function TodoItem(props: { todo: StepTodo }) {
    const { theme } = useTheme()

    const icon = createMemo(() => {
        switch (props.todo.status) {
            case "complete": return "✅"
            case "in_progress": return "🔄"
            case "failed": return "❌"
            default: return "○"
        }
    })

    const color = createMemo(() => {
        switch (props.todo.status) {
            case "complete": return theme.success
            case "in_progress": return theme.accent
            case "failed": return theme.error
            default: return theme.textMuted
        }
    })

    return (
        <text fg={color()}>
            {icon()} {props.todo.content}
        </text>
    )
}

// Re-export ChainWidget for backwards compatibility
export { ChainProgressBar as ChainWidget }
