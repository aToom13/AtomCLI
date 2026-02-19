import { For, Show, createMemo, createSignal, Switch, Match } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { StatusIcons, type AgentChain, type ChainStep, type StepTodo, type SubStep } from "@/agent/chain"

/**
 * Task Chain Progress Bar - Redesigned
 * 
 * Shows a team orchestration view or a sub-agent's own step sequence.
 * - Always visible progress bar at the top (with clear dot indicators tracking steps)
 * - Click to expand into a layered, clearly bordered step list
 * - Turkish localizations and clearer status hints
 */
export function ChainProgressBar(props: { chain: AgentChain | null }) {
    const { theme } = useTheme()
    const [expanded, setExpanded] = createSignal(false)
    const [selectedStep, setSelectedStep] = createSignal<number | null>(null)
    const [selectedSubStep, setSelectedSubStep] = createSignal<number | null>(null)

    const totalSteps = createMemo(() => props.chain?.steps.length ?? 0)
    const completedSteps = createMemo(() =>
        props.chain?.steps.filter((s) => s.status === "complete").length ?? 0
    )
    const hasError = createMemo(() =>
        props.chain?.steps.some((s) => s.status === "failed") ?? false
    )

    const selectedStepData = createMemo(() => {
        const idx = selectedStep()
        if (idx === null || !props.chain) return null
        return props.chain.steps[idx] ?? null
    })

    const selectedStepTodos = createMemo(() => {
        return selectedStepData()?.todos ?? []
    })

    const selectedStepSubSteps = createMemo(() => {
        return selectedStepData()?.subSteps ?? []
    })

    const selectedSubStepData = createMemo(() => {
        const si = selectedSubStep()
        const subs = selectedStepSubSteps()
        if (si === null || si >= subs.length) return null
        return subs[si]
    })

    const selectStep = (idx: number | null) => {
        if (selectedStep() === idx) {
            setSelectedStep(null)
            setSelectedSubStep(null)
        } else {
            setSelectedStep(idx)
            setSelectedSubStep(null)
        }
    }

    return (
        <Show when={props.chain && totalSteps() > 0}>
            <box flexDirection="column">
                {/* Progress Bar - Always Visible */}
                <box
                    flexDirection="row"
                    paddingLeft={1}
                    paddingRight={1}
                    paddingTop={0}
                    paddingBottom={0}
                    backgroundColor={theme.backgroundPanel}
                    border={["bottom"]}
                    borderColor={expanded() ? theme.borderActive : theme.border}
                    gap={1}
                    onMouseUp={() => setExpanded((prev) => !prev)}
                >
                    <text fg={theme.accent}>
                        <span style={{ bold: true }}>{expanded() ? "▼" : "▶"} GÖREV PLANI</span>
                    </text>

                    {/* Dots */}
                    <box flexDirection="row" gap={0} paddingLeft={1}>
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
                    <text fg={theme.textMuted} paddingLeft={1}>
                        ({completedSteps()}/{totalSteps()})
                    </text>

                    <Show when={hasError()}>
                        <text fg={theme.error} paddingLeft={1}>⚠️ Hata</text>
                    </Show>
                </box>

                {/* Expanded Task List View */}
                <Show when={expanded()}>
                    <box
                        flexDirection="row"
                        backgroundColor={theme.background}
                        border={["bottom"]}
                        borderColor={theme.border}
                        minHeight={10}
                        maxHeight={20}
                    >
                        {/* Left: Step List */}
                        <box
                            flexDirection="column"
                            paddingLeft={1}
                            paddingRight={2}
                            paddingTop={1}
                            paddingBottom={1}
                            flexShrink={0}
                        >
                            <For each={props.chain!.steps}>
                                {(step, i) => (
                                    <box flexDirection="column">
                                        <ChainStepRow
                                            step={step}
                                            index={i()}
                                            isCurrent={i() === props.chain!.currentStep}
                                            isSelected={selectedStep() === i()}
                                            onClick={() => selectStep(i())}
                                        />

                                        {/* Nested Sub-Steps (Indented) */}
                                        <Show when={(step.subSteps?.length ?? 0) > 0}>
                                            <box flexDirection="column" paddingLeft={4} border={["left"]} borderColor={selectedStep() === i() ? theme.accent : theme.border}>
                                                <Show when={step.subPlanReason}>
                                                    <text fg={theme.warning}>
                                                        ⚠️ {step.subPlanReason}
                                                    </text>
                                                </Show>
                                                <For each={step.subSteps!}>
                                                    {(sub, si) => {
                                                        const isSubSelected = createMemo(() => selectedStep() === i() && selectedSubStep() === si())
                                                        const subColor = createMemo(() => {
                                                            if (sub.status === "complete") return theme.success
                                                            if (sub.status === "failed") return theme.error
                                                            if (sub.status === "running") return theme.accent
                                                            return theme.textMuted
                                                        })
                                                        return (
                                                            <box onMouseUp={() => { setSelectedStep(i()); setSelectedSubStep(selectedSubStep() === si() ? null : si()) }}>
                                                                <text fg={subColor()}>
                                                                    {isSubSelected() ? "▶" : "─"} {StatusIcons[sub.status] ?? "⏳"} {sub.name}
                                                                </text>
                                                            </box>
                                                        )
                                                    }}
                                                </For>
                                            </box>
                                        </Show>
                                    </box>
                                )}
                            </For>
                        </box>

                        {/* Right: Detail Panel */}
                        <box
                            flexDirection="column"
                            paddingLeft={2}
                            paddingRight={2}
                            paddingTop={1}
                            paddingBottom={1}
                            flexGrow={1}
                            border={["left"]}
                            borderColor={theme.border}
                            backgroundColor={theme.backgroundPanel}
                        >
                            {/* Detailed View logic based on selection */}
                            <Switch>
                                <Match when={selectedSubStepData()}>
                                    <box flexDirection="column">
                                        <text fg={theme.accent}>
                                            <span style={{ bold: true }}>🔧 Alt Görev Detayı</span>
                                        </text>
                                        <text fg={theme.text}>{selectedSubStepData()!.name}</text>
                                        <text fg={theme.textMuted}>{selectedSubStepData()!.description}</text>
                                        <text fg={theme.textMuted}>
                                            Durum: {StatusIcons[selectedSubStepData()!.status] ?? "⏳"} {selectedSubStepData()!.status}
                                        </text>
                                    </box>
                                </Match>

                                <Match when={selectedStep() !== null && selectedStepSubSteps().length > 0}>
                                    <box flexDirection="column">
                                        <text fg={theme.accent}>
                                            <span style={{ bold: true }}>📋 Alt Plan: {selectedStepData()?.name}</span>
                                        </text>
                                        <Show when={selectedStepData()?.subPlanReason}>
                                            <text fg={theme.warning}>
                                                Sebep: {selectedStepData()!.subPlanReason}
                                            </text>
                                        </Show>
                                        <text fg={theme.textMuted}>
                                            {selectedStepSubSteps().filter(s => s.status === "complete").length}/{selectedStepSubSteps().length} tamamlandı
                                        </text>
                                    </box>
                                </Match>

                                <Match when={selectedStep() !== null && selectedStepTodos().length > 0}>
                                    <box flexDirection="column">
                                        <text fg={theme.accent}>
                                            <span style={{ bold: true }}>📝 Yapılacaklar</span>
                                        </text>
                                        <For each={selectedStepTodos()}>
                                            {(todo) => <TodoItem todo={todo} />}
                                        </For>
                                    </box>
                                </Match>

                                <Match when={selectedStep() !== null}>
                                    <box flexDirection="column">
                                        <text fg={theme.accent}>
                                            <span style={{ bold: true }}>{selectedStepData()?.name}</span>
                                        </text>
                                        <text fg={theme.textMuted}>
                                            Durum: {StatusIcons[selectedStepData()?.status ?? "pending"] ?? "⏳"} {selectedStepData()?.status}
                                        </text>
                                        <Show when={selectedStepData()?.output}>
                                            <text fg={theme.success}>
                                                Çıktı: {selectedStepData()!.output}
                                            </text>
                                        </Show>
                                        <Show when={selectedStepData()?.error}>
                                            <text fg={theme.error}>
                                                Hata: {selectedStepData()!.error}
                                            </text>
                                        </Show>
                                    </box>
                                </Match>

                                <Match when={true}>
                                    <text fg={theme.textMuted}>
                                        ← Detayları görmek için bir adıma tıklayın.
                                    </text>
                                </Match>
                            </Switch>
                        </box>
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
    const hasSubSteps = createMemo(() => (props.step.subSteps?.length ?? 0) > 0)
    const completedSubSteps = createMemo(() =>
        props.step.subSteps?.filter(s => s.status === "complete").length ?? 0
    )

    return (
        <box flexDirection="column" onMouseUp={props.onClick}>
            {/* Main row */}
            <text fg={color()}>
                {props.isSelected ? "▶ " : "  "}
                {props.index + 1}. {icon()} {props.step.name}
                <Show when={props.step.agentType}>
                    <span style={{ fg: theme.accent, inverse: true }}> @{props.step.agentType} </span>
                </Show>
                <Show when={hasTodos()}>
                    <span style={{ fg: theme.textMuted }}> [{props.step.todos?.filter(t => t.status === "complete").length}/{props.step.todos?.length}]</span>
                </Show>
                <Show when={hasSubSteps()}>
                    <span style={{ fg: theme.warning }}> 🔧{completedSubSteps()}/{props.step.subSteps!.length}</span>
                </Show>
            </text>

            {/* Dependency and Details summary under the step name */}
            <Show when={props.step.dependsOn && props.step.dependsOn.length > 0}>
                <text fg={theme.textMuted} paddingLeft={5}>
                    └─ 🔗 Beklenen: {props.step.dependsOn!.join(", ")}
                </text>
            </Show>
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

export { ChainProgressBar as ChainWidget }
