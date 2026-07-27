import { For, Show, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useSync } from "@tui/context/sync"
import { useRoute } from "@tui/context/route"
import { useTheme } from "@tui/context/theme"
import { useSubAgents, type ActiveSubAgent } from "@tui/context/subagent"
import { useSDK } from "@tui/context/sdk"
import { Focusable } from "@tui/context/spatial"
import { Identifier } from "@/core/id/id"

/**
 * SubAgentPanel — Dynamic right-side panel
 *
 * Three display modes — ALL are readable, no useless nano strip:
 *   compact (25–34 cols): tight single-line cards, no borders, icon + name
 *   normal  (35–47 cols): bordered cards, status badge, tool activity
 *   wide    (48+ cols):   full cards with description + text preview
 *
 * MINIMUM width is 25 chars. Below that the panel hides entirely (handled
 * by the auto-close logic in subagent.tsx context when terminal < 75 cols).
 *
 * OPENTUI RULE: Never nest <text> inside <text>. Use <box flexDirection="row">
 * with sibling <text> nodes for multi-color rows.
 */

type DisplayMode = "compact" | "normal" | "wide"

function getDisplayMode(pw: number): DisplayMode {
  if (pw < 35) return "compact"
  if (pw < 48) return "normal"
  return "wide"
}

/**
 * Compute panel width from terminal columns.
 *
 * MINIMUM: 25 chars — enough for "⟳ @agentType" + status.
 * If terminal is < 75 cols, subagent context auto-hides the panel,
 * so this function always returns a usable width.
 *
 *   terminal < 90   →  25  (compact, tight)
 *   terminal < 120  →  30  (compact, roomier)
 *   terminal < 150  →  40  (normal)
 *   terminal < 180  →  50  (wide)
 *   terminal >= 180 →  58  (wide, spacious)
 */
export function computePanelWidth(terminalWidth: number): number {
  if (terminalWidth < 90) return 25
  if (terminalWidth < 120) return 30
  if (terminalWidth < 150) return 40
  if (terminalWidth < 180) return 50
  return 58
}

interface Props {
  agents: ActiveSubAgent[]
  onToggle?: () => void
}

export function SubAgentPanel(props: Props) {
  const dimensions = useTerminalDimensions()
  const pw = createMemo(() => computePanelWidth(dimensions().width))
  const mode = createMemo(() => getDisplayMode(pw()))
  const running = createMemo(() => props.agents.filter((a) => a.status === "running").length)
  const waiting = createMemo(() => props.agents.filter((a) => a.status === "waiting").length)

  const { navigate } = useRoute()
  const { theme } = useTheme()
  const subAgentCtx = useSubAgents()

  // Separator line: width − left border (1) − padding (2)
  const sep = createMemo(() => "─".repeat(Math.max(0, pw() - 3)))

  const parentId = () => subAgentCtx.parentSessionId()
  const goToParent = () => {
    const pid = parentId()
    if (pid) navigate({ type: "session", sessionID: pid })
  }

  return (
    <box flexDirection="column" width={pw()} flexShrink={0} border={["left"]} borderColor={theme.borderActive}>

      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <box
        flexDirection="column"
        flexShrink={0}
        backgroundColor={theme.backgroundPanel}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
      >
        {/* Row 1: Title + toggle */}
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.accent}>{"◈ Agents"}</text>
          <Focusable id="agent-panel-toggle" onPress={() => props.onToggle?.()}>
            {(f: () => boolean) => (
              <box onMouseUp={() => props.onToggle?.()} backgroundColor={f() ? theme.primary : undefined} paddingLeft={1}>
                <text fg={f() ? theme.text : theme.textMuted}>{"[F9]"}</text>
              </box>
            )}
          </Focusable>
        </box>

        {/* Row 2: Status — compact: "⟳2 ⏸1", normal+: "⟳ N running │ ⏸ M idle" */}
        <box flexDirection="row" paddingTop={1} gap={1}>
          <Show when={mode() === "compact"} fallback={
            <>
              <text fg={running() > 0 ? theme.success : theme.border}>{"⟳"}</text>
              <text fg={running() > 0 ? theme.text : theme.textMuted}>{running() + " running"}</text>
              <text fg={theme.border}>{"│"}</text>
              <text fg={waiting() > 0 ? theme.warning : theme.border}>{"⏸"}</text>
              <text fg={waiting() > 0 ? theme.text : theme.textMuted}>{waiting() + " idle"}</text>
            </>
          }>
            <text fg={running() > 0 ? theme.success : theme.textMuted}>{"⟳" + running()}</text>
            <text fg={waiting() > 0 ? theme.warning : theme.textMuted}>{"⏸" + waiting()}</text>
          </Show>
        </box>

        {/* Row 3: ↑ Back to parent — always visible */}
        <box paddingTop={1}>
          <Focusable id={Identifier.ascending("part")} onPress={goToParent}>
            {(f: () => boolean) => {
              const has = !!parentId()
              return (
                <box
                  onMouseUp={goToParent}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={f() && has ? theme.primary : has ? theme.backgroundElement : undefined}
                  border={["top", "bottom", "left", "right"]}
                  borderColor={f() && has ? theme.accent : has ? theme.border : theme.borderSubtle}
                >
                  <text fg={f() && has ? theme.text : has ? theme.accent : theme.textMuted}>
                    {mode() === "compact" ? "↑ Ana" : "↑ Ana Agent"}
                  </text>
                </box>
              )
            }}
          </Focusable>
        </box>
      </box>

      {/* ── SEPARATOR ──────────────────────────────────────────────────────── */}
      <box flexShrink={0} paddingLeft={1}>
        <text fg={theme.border}>{sep()}</text>
      </box>

      {/* ── AGENT CARDS ────────────────────────────────────────────────────── */}
      <Show when={props.agents.length > 0}>
        <scrollbox flexGrow={1} scrollY scrollX={false} paddingLeft={1} paddingRight={1} paddingTop={1}>
          <For each={props.agents}>
            {(agent) => <AgentCard agent={agent} mode={mode()} pw={pw()} />}
          </For>
        </scrollbox>
      </Show>

      {/* ── EMPTY STATE ────────────────────────────────────────────────────── */}
      <Show when={props.agents.length === 0}>
        <box flexGrow={1} alignItems="center" justifyContent="center">
          <text fg={theme.textMuted}>{"— boşta —"}</text>
        </box>
      </Show>
    </box>
  )
}

// ── AGENT CARD ───────────────────────────────────────────────────────────────
interface CardProps {
  agent: ActiveSubAgent
  mode: DisplayMode
  pw: number
}

function AgentCard(props: CardProps) {
  const sync = useSync()
  const { navigate } = useRoute()
  const { theme } = useTheme()
  const sdk = useSDK()
  const subAgentCtx = useSubAgents()

  const isDone = () => props.agent.status === "done"
  const isWaiting = () => props.agent.status === "waiting"
  const isRunning = () => props.agent.status === "running"

  const messages = createMemo(() => sync.data.message[props.agent.sessionId] ?? [])
  const lastMsg = createMemo(() => messages().findLast((m) => m.role === "assistant"))
  const parts = createMemo(() => (lastMsg() ? (sync.data.part[lastMsg()!.id] ?? []) : []))
  const lastTool = createMemo(() => parts().findLast((p: any) => p.type === "tool" && p.state?.status === "running") as any)
  const lastText = createMemo(() => parts().findLast((p: any) => p.type === "text") as any)

  const statusColor = () => (isDone() ? theme.textMuted : isWaiting() ? theme.warning : theme.success)
  const cardBorder = () => (isDone() ? theme.border : isWaiting() ? theme.warning : theme.success)
  const statusIcon = () => (isDone() ? "✓" : isWaiting() ? "⏸" : "⟳")

  // Inner width: pw − border(2) − padding(2)
  const inner = () => Math.max(6, props.pw - 4)
  const typeChars = () => Math.max(3, inner() - 5) // room for icon + status icon
  const toolChars = () => Math.max(4, inner() - 2)
  const textChars = () => Math.max(4, inner() - 1)

  const killAgent = async () => {
    if (isRunning() || isWaiting()) {
      await sdk.client.session.abort({ sessionID: props.agent.sessionId }).catch(() => {})
    }
    subAgentCtx.removeAgent(props.agent.sessionId)
  }
  const openSession = () => navigate({ type: "session", sessionID: props.agent.sessionId })

  // ── COMPACT: tight card — no border box, but still informative ─────────
  if (props.mode === "compact") {
    return (
      <box flexDirection="column" marginBottom={1}>
        {/* Agent row: clickable */}
        <Focusable id={`open-${props.agent.sessionId}`} onPress={openSession}>
          {(f: () => boolean) => (
            <box flexDirection="row" justifyContent="space-between" onMouseUp={openSession} backgroundColor={f() ? theme.primary : undefined}>
              <box flexDirection="row">
                <text fg={statusColor()}>{statusIcon() + " "}</text>
                <text fg={f() ? theme.text : theme.accent}>{props.agent.agentType.slice(0, typeChars())}</text>
              </box>
              <text fg={theme.textMuted}>{"↗"}</text>
            </box>
          )}
        </Focusable>

        {/* Tool activity — always shown when running */}
        <Show when={isRunning() && lastTool()}>
          <box paddingLeft={2}>
            <text fg={theme.textMuted}>{String(lastTool()?.name ?? lastTool()?.tool ?? "…").slice(0, toolChars())}</text>
          </box>
        </Show>

        {/* Waiting/done status */}
        <Show when={isWaiting()}>
          <box paddingLeft={2}>
            <text fg={theme.warning}>{"bekliyor…"}</text>
          </box>
        </Show>

        {/* Kill on separate row */}
        <box paddingLeft={2}>
          <Focusable id={`kill-${props.agent.sessionId}`} onPress={killAgent}>
            {(f: () => boolean) => (
              <box onMouseUp={killAgent} backgroundColor={f() ? theme.error : undefined}>
                <text fg={f() ? theme.text : theme.error}>{"✖"}</text>
              </box>
            )}
          </Focusable>
        </box>
      </box>
    )
  }

  // ── NORMAL / WIDE: bordered card ────────────────────────────────────────
  return (
    <box flexDirection="column" border={["top", "left", "right", "bottom"]} borderColor={cardBorder()} marginBottom={1}>

      {/* Header: @type + status */}
      <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1} paddingTop={1} backgroundColor={theme.backgroundElement}>
        <text fg={theme.accent}>{"@" + props.agent.agentType.slice(0, typeChars())}</text>
        <text fg={statusColor()}>{statusIcon() + (props.mode === "wide" ? (isDone() ? " done" : isWaiting() ? " idle" : " run") : "")}</text>
      </box>

      {/* Description — wide only */}
      <Show when={props.mode === "wide" && props.agent.description}>
        <box paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>{props.agent.description.slice(0, textChars())}</text>
        </box>
      </Show>

      {/* Activity */}
      <box paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
        <Show when={isRunning() && lastTool()}>
          <box flexDirection="row">
            <text fg={theme.textMuted}>{"🔧 "}</text>
            <text fg={theme.text}>{String(lastTool()?.name ?? lastTool()?.tool ?? "…").slice(0, toolChars())}</text>
          </box>
        </Show>
        <Show when={isRunning() && !lastTool() && lastText()?.text}>
          <text fg={theme.textMuted}>
            {String(lastText()?.text ?? "").split("\n").find((l) => l.trim())?.slice(0, textChars()) ?? ""}
          </text>
        </Show>
        <Show when={isWaiting()}>
          <text fg={theme.warning}>{"Bekliyor…"}</text>
        </Show>
        <Show when={isDone()}>
          <text fg={theme.success}>{"Tamamlandı"}</text>
        </Show>
      </box>

      {/* Action bar */}
      <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1} paddingBottom={1}>
        <Focusable id={`open-${props.agent.sessionId}`} onPress={openSession}>
          {(f: () => boolean) => (
            <box
              onMouseUp={openSession}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={f() ? theme.primary : theme.backgroundElement}
              border={["top", "bottom", "left", "right"]}
              borderColor={f() ? theme.accent : theme.border}
            >
              <text fg={f() ? theme.text : theme.textMuted}>{"↗ aç"}</text>
            </box>
          )}
        </Focusable>
        <Focusable id={`kill-${props.agent.sessionId}`} onPress={killAgent}>
          {(f: () => boolean) => (
            <box
              onMouseUp={killAgent}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={f() ? theme.error : theme.backgroundElement}
              border={["top", "bottom", "left", "right"]}
              borderColor={f() ? theme.error : theme.border}
            >
              <text fg={f() ? theme.text : theme.error}>{"✖"}</text>
            </box>
          )}
        </Focusable>
      </box>
    </box>
  )
}
