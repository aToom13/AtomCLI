import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { StatusIcons, type AgentChain, type ChainStep, type StepTodo, type SubStep } from "@/integrations/agent/chain"
import { useSession } from "@tui/routes/session/context"
import { useTerminalDimensions } from "@opentui/solid"
import { SessionLayout } from "@tui/routes/session/layout"
import { Locale } from "@/util/util/locale"
import { runningAgentsForStep, useSubAgents } from "@tui/context/subagent"

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
  const session = useSession()
  const subAgents = useSubAgents()
  const dimensions = useTerminalDimensions()
  const [expanded, setExpanded] = createSignal(false)
  const [selectedStep, setSelectedStep] = createSignal<number | null>(null)
  const [selectedSubStep, setSelectedSubStep] = createSignal<number | null>(null)

  const totalSteps = createMemo(() => props.chain?.steps.length ?? 0)
  const completedSteps = createMemo(() => props.chain?.steps.filter((s) => s.status === "complete").length ?? 0)
  const hasError = createMemo(() => props.chain?.steps.some((s) => s.status === "failed") ?? false)
  const compact = createMemo(() => session.width < 58)
  const narrow = createMemo(() => session.width < 82)
  const dense = createMemo(() => session.verticalMode !== "normal")
  const contentRows = createMemo(
    () =>
      props.chain?.steps.reduce(
        (rows, step) =>
          rows + 1 + (step.dependsOn?.length ? 1 : 0) + (step.subPlanReason ? 1 : 0) + (step.subSteps?.length ?? 0),
        0,
      ) ?? 0,
  )
  const expandedHeight = createMemo(() => SessionLayout.chainExpandedHeight(dimensions().height, contentRows()))
  const needsScrollbar = createMemo(() =>
    SessionLayout.chainNeedsScrollbar(dimensions().height, expandedHeight(), contentRows()),
  )
  const listWidth = createMemo(() =>
    narrow() || dense() ? session.width : Math.max(24, Math.floor(session.width * 0.45)),
  )
  const stepNameWidth = (step: ChainStep, index: number) => {
    const agentBadge = step.agentType ? step.agentType.length + 4 : 0
    const todoBadge = step.todos?.length ? String(step.todos.length).length * 2 + 5 : 0
    const subStepBadge = step.subSteps?.length ? String(step.subSteps.length).length * 2 + 4 : 0
    return SessionLayout.chainStepNameWidth(listWidth(), index, agentBadge + todoBadge + subStepBadge)
  }

  const currentStepData = createMemo(() => {
    const chain = props.chain
    if (!chain || chain.steps.length === 0) return null
    const index = Math.min(Math.max(0, chain.currentStep), chain.steps.length - 1)
    return chain.steps[index] ?? null
  })
  const showCurrentTask = createMemo(() => !expanded() && !!currentStepData() && props.chain?.status !== "complete")
  const currentTaskWidth = createMemo(() => Math.max(8, session.width - (compact() ? 20 : 36)))
  const currentTaskName = createMarqueeText(
    () => SessionLayout.chainStepLabel(currentStepData()?.name ?? ""),
    currentTaskWidth,
    showCurrentTask,
  )
  const currentTaskState = createMemo(() => {
    switch (currentStepData()?.status) {
      case "running":
        return compact() ? "aktif" : "çalışıyor"
      case "coding":
        return compact() ? "kod" : "kod yazıyor"
      case "searching_web":
        return compact() ? "web" : "web'de arıyor"
      case "searching_code":
        return compact() ? "arama" : "kod arıyor"
      case "reading_file":
        return compact() ? "okuyor" : "dosya okuyor"
      case "writing_file":
        return compact() ? "yazıyor" : "dosya yazıyor"
      case "running_command":
        return compact() ? "komut" : "komut çalıştırıyor"
      case "analyzing":
        return compact() ? "analiz" : "analiz ediyor"
      case "thinking":
        return compact() ? "düşünüyor" : "düşünüyor"
      case "retrying":
        return compact() ? "tekrar" : "yeniden deneniyor"
      case "failed":
        return compact() ? "hata" : "başarısız"
      case "complete":
        return compact() ? "bitti" : "tamamlandı"
      case "pending":
        return compact() ? "sırada" : "sıradaki"
      default:
        return compact() ? "aktif" : "çalışıyor"
    }
  })

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

  const selectedStepAgents = createMemo(() => {
    const step = selectedStepData()
    const index = selectedStep()
    if (!step || index === null || !props.chain) return []
    return runningAgentsForStep(subAgents.agents(), step.id, index === props.chain.currentStep, session.sessionID)
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

  let taskList: ScrollBoxRenderable | undefined
  createEffect(() => {
    const chain = props.chain
    if (!chain || !expanded()) return
    const current = Math.min(Math.max(0, chain.currentStep), chain.steps.length - 1)
    if (current < 0) return

    // Opening the panel and every task transition should immediately show
    // the active task's detail; the user can still select another row
    // manually until the active task changes again.
    setSelectedStep(current)
    setSelectedSubStep(null)

    const rowCounts = chain.steps.map(
      (step) => 1 + (step.dependsOn?.length ? 1 : 0) + (step.subPlanReason ? 1 : 0) + (step.subSteps?.length ?? 0),
    )
    const viewportRows = SessionLayout.chainListViewportRows(dimensions().height, expandedHeight())
    const offset = SessionLayout.chainCenteredScrollOffset(rowCounts, current, viewportRows)

    // ScrollBox calculates its real viewport on the next renderer tick.
    // Applying the target once immediately and twice after measurement
    // keeps the current task centred when the panel opens or advances.
    const follow = () => taskList?.scrollTo(offset)
    const first = setTimeout(follow, 0)
    const measured = setTimeout(follow, 40)
    const settled = setTimeout(follow, 120)
    onCleanup(() => {
      clearTimeout(first)
      clearTimeout(measured)
      clearTimeout(settled)
    })
  })

  return (
    <Show when={props.chain && totalSteps() > 0}>
      <box flexDirection="column" flexShrink={0}>
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
          <text fg={theme.accent} wrapMode="none">
            <span style={{ bold: true }}>
              {expanded() ? "▼" : "▶"} {compact() ? "Tasks" : "Task plan"}
            </span>
          </text>

          {/* Dots */}
          <Show when={!compact()}>
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
          </Show>

          {/* Status summary */}
          <text fg={theme.textMuted} paddingLeft={1} wrapMode="none">
            ({completedSteps()}/{totalSteps()})
          </text>

          <Show when={hasError()}>
            <text fg={theme.error} paddingLeft={1}>
              {compact() ? "!" : "⚠ Error"}
            </text>
          </Show>
        </box>

        {/* Keep the current work visible even while the full plan is collapsed. */}
        <Show when={showCurrentTask()}>
          <box
            flexDirection="row"
            height={1}
            flexShrink={0}
            paddingLeft={2}
            paddingRight={1}
            backgroundColor={theme.backgroundPanel}
            gap={1}
          >
            <text fg={theme.accent} wrapMode="none">
              <span style={{ bold: true }}>◆ Şimdi</span>
            </text>
            <text fg={theme.text} width={currentTaskWidth()} wrapMode="none" overflow="hidden">
              {currentTaskName()}
            </text>
            <box flexGrow={1} />
            <text
              fg={currentStepData()?.status === "failed" ? theme.error : theme.accent}
              wrapMode="none"
              flexShrink={0}
            >
              {StatusIcons[currentStepData()?.status ?? "pending"] ?? "⏳"} {currentTaskState()}
            </text>
          </box>
        </Show>

        {/* Expanded Task List View */}
        <Show when={expanded()}>
          <box
            flexDirection={narrow() || dense() ? "column" : "row"}
            backgroundColor={theme.background}
            border={["bottom"]}
            borderColor={theme.border}
            height={expandedHeight()}
          >
            {/* Left: Step List */}
            <scrollbox
              ref={(renderable: ScrollBoxRenderable) => (taskList = renderable)}
              paddingLeft={1}
              paddingRight={dense() ? 1 : 2}
              paddingTop={dense() ? 0 : 1}
              paddingBottom={dense() ? 0 : 1}
              flexGrow={narrow() || dense() ? 1 : 0}
              width={narrow() || dense() ? "100%" : listWidth()}
              height="100%"
              contentOptions={SessionLayout.chainScrollContentOptions}
              verticalScrollbarOptions={{ visible: needsScrollbar() }}
              horizontalScrollbarOptions={{ visible: false }}
              scrollX={false}
            >
              <For each={props.chain!.steps}>
                {(step, i) => (
                  <box flexDirection="column" flexShrink={0}>
                    <ChainStepRow
                      step={step}
                      index={i()}
                      isCurrent={i() === props.chain!.currentStep}
                      isSelected={selectedStep() === i()}
                      animateName={i() === props.chain!.currentStep || selectedStep() === i()}
                      maxNameWidth={stepNameWidth(step, i())}
                      onClick={() => selectStep(i())}
                    />

                    {/* Nested Sub-Steps (Indented) */}
                    <Show when={(step.subSteps?.length ?? 0) > 0}>
                      <box
                        flexDirection="column"
                        flexShrink={0}
                        paddingLeft={4}
                        border={["left"]}
                        borderColor={selectedStep() === i() ? theme.accent : theme.border}
                      >
                        <Show when={step.subPlanReason}>
                          <text fg={theme.warning} wrapMode="none" height={1} flexShrink={0} overflow="hidden">
                            ⚠️ {Locale.truncate(step.subPlanReason!, stepNameWidth(step, i()))}
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
                              <box
                                height={1}
                                flexShrink={0}
                                overflow="hidden"
                                onMouseUp={() => {
                                  setSelectedStep(i())
                                  setSelectedSubStep(selectedSubStep() === si() ? null : si())
                                }}
                              >
                                <text fg={subColor()} wrapMode="none">
                                  {isSubSelected() ? "▶" : "─"} {StatusIcons[sub.status] ?? "⏳"}{" "}
                                  {Locale.truncate(sub.name, stepNameWidth(step, i()))}
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
            </scrollbox>

            {/* Right: Detail Panel */}
            <Show when={!narrow() && !dense()}>
              <scrollbox
                paddingLeft={2}
                paddingRight={2}
                paddingTop={1}
                paddingBottom={1}
                flexGrow={1}
                border={["left"]}
                borderColor={theme.border}
                backgroundColor={theme.backgroundPanel}
                height="100%"
                contentOptions={SessionLayout.chainScrollContentOptions}
                horizontalScrollbarOptions={{ visible: false }}
                scrollX={false}
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

                  <Match when={selectedStep() !== null}>
                    <box flexDirection="column">
                      <text fg={theme.accent}>
                        <span style={{ bold: true }}>{selectedStepData()?.name}</span>
                      </text>
                      <text fg={theme.textMuted}>
                        Durum: {StatusIcons[selectedStepData()?.status ?? "pending"] ?? "⏳"}{" "}
                        {selectedStepData()?.status}
                      </text>
                      <Show
                        when={
                          selectedStepData()?.description &&
                          selectedStepData()?.description !== selectedStepData()?.name
                        }
                      >
                        <text fg={theme.textMuted}>{selectedStepData()!.description}</text>
                      </Show>
                      <Show when={selectedStepSubSteps().length > 0}>
                        <box flexDirection="column" paddingTop={1}>
                          <text fg={theme.accent}>
                            <span style={{ bold: true }}>📋 Alt Plan</span>
                          </text>
                          <Show when={selectedStepData()?.subPlanReason}>
                            <text fg={theme.warning}>Sebep: {selectedStepData()!.subPlanReason}</text>
                          </Show>
                          <text fg={theme.textMuted}>
                            {selectedStepSubSteps().filter((s) => s.status === "complete").length}/
                            {selectedStepSubSteps().length} tamamlandı
                          </text>
                        </box>
                      </Show>
                      <Show when={selectedStepTodos().length > 0}>
                        <box flexDirection="column" paddingTop={1}>
                          <text fg={theme.accent}>
                            <span style={{ bold: true }}>📝 Yapılacaklar</span>
                          </text>
                          <For each={selectedStepTodos()}>{(todo) => <TodoItem todo={todo} />}</For>
                        </box>
                      </Show>
                      <Show when={selectedStepData()?.output}>
                        <text fg={theme.success}>Çıktı: {selectedStepData()!.output}</text>
                      </Show>
                      <Show when={selectedStepData()?.error}>
                        <text fg={theme.error}>Hata: {selectedStepData()!.error}</text>
                      </Show>
                    </box>
                  </Match>

                  <Match when={true}>
                    <text fg={theme.textMuted}>← Detayları görmek için bir adıma tıklayın.</text>
                  </Match>
                </Switch>

                <Show when={selectedStepAgents().length > 0}>
                  <box flexDirection="column" paddingTop={1}>
                    <text fg={theme.accent}>
                      <span style={{ bold: true }}>
                        {selectedStepAgents().length === 1
                          ? "◈ Çalışan agent"
                          : `◈ Çalışan agentlar (${selectedStepAgents().length})`}
                      </span>
                    </text>
                    <For each={selectedStepAgents()}>
                      {(agent) => (
                        <box flexDirection="column" paddingTop={1}>
                          <text fg={theme.success}>⟳ @{agent.agentType}</text>
                          <text fg={theme.text}>{agent.description}</text>
                          <text fg={theme.textMuted}>Oturum: {agent.sessionId}</text>
                        </box>
                      )}
                    </For>
                  </box>
                </Show>
              </scrollbox>
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
  animateName: boolean
  maxNameWidth: number
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
  const completedSubSteps = createMemo(() => props.step.subSteps?.filter((s) => s.status === "complete").length ?? 0)
  const name = createMarqueeText(
    () => SessionLayout.chainStepLabel(props.step.name),
    () => props.maxNameWidth,
    () => props.animateName,
  )

  return (
    <box flexDirection="column" flexShrink={0} overflow="hidden" onMouseUp={props.onClick}>
      {/* Main row */}
      <text fg={color()} wrapMode="none" height={1} flexShrink={0} overflow="hidden">
        {props.isSelected ? "▶ " : "  "}
        {props.index + 1}. {icon()} {name()}
        <Show when={props.step.agentType}>
          <span style={{ fg: theme.accent, inverse: true }}> @{props.step.agentType} </span>
        </Show>
        <Show when={hasTodos()}>
          <span style={{ fg: theme.textMuted }}>
            {" "}
            [{props.step.todos?.filter((t) => t.status === "complete").length}/{props.step.todos?.length}]
          </span>
        </Show>
        <Show when={hasSubSteps()}>
          <span style={{ fg: theme.warning }}>
            {" "}
            🔧{completedSubSteps()}/{props.step.subSteps!.length}
          </span>
        </Show>
      </text>

      {/* Dependency and Details summary under the step name */}
      <Show when={props.step.dependsOn && props.step.dependsOn.length > 0}>
        <text fg={theme.textMuted} paddingLeft={5} wrapMode="none" height={1} flexShrink={0} overflow="hidden">
          └─ 🔗 Beklenen: {Locale.truncate(props.step.dependsOn!.join(", "), props.maxNameWidth)}
        </text>
      </Show>
    </box>
  )
}

function createMarqueeText(text: () => string, width: () => number, enabled: () => boolean) {
  const [offset, setOffset] = createSignal(0)

  createEffect(() => {
    const value = text()
    const visibleWidth = Math.max(1, width())
    const shouldAnimate = enabled() && Array.from(value).length > visibleWidth
    setOffset(0)
    if (!shouldAnimate) return

    const maxOffset = Math.max(0, Array.from(value).length - (visibleWidth - 1))
    let direction = 1
    let holdTicks = 12
    const timer = setInterval(() => {
      if (holdTicks > 0) {
        holdTicks--
        return
      }

      setOffset((current) => {
        const next = current + direction
        if (next >= maxOffset) {
          direction = -1
          holdTicks = 8
          return maxOffset
        }
        if (next <= 0) {
          direction = 1
          holdTicks = 12
          return 0
        }
        return next
      })
    }, 90)

    onCleanup(() => clearInterval(timer))
  })

  return createMemo(() => {
    const value = text()
    const visibleWidth = Math.max(1, width())
    if (!enabled()) return Locale.truncate(value, visibleWidth)
    return SessionLayout.marqueeWindow(value, visibleWidth, offset())
  })
}

function TodoItem(props: { todo: StepTodo }) {
  const { theme } = useTheme()

  const icon = createMemo(() => {
    switch (props.todo.status) {
      case "complete":
        return "✅"
      case "in_progress":
        return "🔄"
      case "failed":
        return "❌"
      default:
        return "○"
    }
  })

  const color = createMemo(() => {
    switch (props.todo.status) {
      case "complete":
        return theme.success
      case "in_progress":
        return theme.accent
      case "failed":
        return theme.error
      default:
        return theme.textMuted
    }
  })

  return (
    <text fg={color()}>
      {icon()} {props.todo.content}
    </text>
  )
}

export { ChainProgressBar as ChainWidget }
