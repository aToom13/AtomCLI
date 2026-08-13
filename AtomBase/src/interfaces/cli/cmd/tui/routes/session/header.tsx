import { type Accessor, createMemo, Match, Show, Switch } from "solid-js"
import { useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { pipe, sumBy } from "remeda"
import { useTheme } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"
import type { AssistantMessage, Session } from "@atomcli/sdk/v2"
import { useKeybind } from "../../context/keybind"
import { ChainProgressBar } from "@tui/component/chain-widget"
import { useChain } from "@tui/context/chain"
import { useSubAgents } from "@tui/context/subagent"
import { Focusable } from "@tui/context/spatial"
import { useSession } from "./context"
import { Locale } from "@/util/util/locale"

const Title = (props: { session: Accessor<Session>; width: number }) => {
  const { theme } = useTheme()
  const title = createMemo(() => Locale.truncateMiddle(props.session().title, Math.max(8, props.width - 3)))
  return (
    <text fg={theme.text} wrapMode="none" flexShrink={1}>
      <span style={{ bold: true }}>#</span> <span style={{ bold: true }}>{title()}</span>
    </text>
  )
}

const ContextInfo = (props: { context: Accessor<string | undefined>; cost: Accessor<string> }) => {
  const { theme } = useTheme()
  return (
    <Show when={props.context()}>
      <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
        {props.context()} ({props.cost()})
      </text>
    </Show>
  )
}

function AgentToggleButton(props: { compact: boolean }) {
  const { theme } = useTheme()
  const subAgentCtx = useSubAgents()
  const agentCount = () => subAgentCtx.agents().length
  const isVisible = () => subAgentCtx.panelVisible()

  return (
    <Focusable id="agents-toggle" onPress={() => subAgentCtx.togglePanel()}>
      {(focused: () => boolean) => (
        <box
          onMouseUp={() => subAgentCtx.togglePanel()}
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={focused() ? theme.primary : undefined}
        >
          <Show
            when={agentCount() > 0}
            fallback={<text fg={isVisible() ? theme.accent : theme.textMuted}>{props.compact ? "⊞" : "⊞ Agents"}</text>}
          >
            <text fg={isVisible() ? theme.accent : theme.textMuted}>
              {props.compact ? `⊞ ${agentCount()}` : `⊞ ${agentCount()} Agents`}
            </text>
          </Show>
        </box>
      )}
    </Focusable>
  )
}

export function Header() {
  const route = useRouteData("session")
  const sync = useSync()
  const chainCtx = useChain()
  const sessionContext = useSession()
  const session = createMemo(() => sync.session.get(route.sessionID)!)
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])

  const cost = createMemo(() => {
    const total = pipe(
      messages(),
      sumBy((x) => (x.role === "assistant" ? x.cost : 0)),
    )
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    let result = total.toLocaleString()
    if (model?.limit.context) {
      result += "  " + Math.round((total / model.limit.context) * 100) + "%"
    }
    return result
  })

  const { theme } = useTheme()
  const keybind = useKeybind()
  const compact = createMemo(() => sessionContext.width < 56)
  const narrow = createMemo(() => sessionContext.width < 78)
  const titleWidth = createMemo(() => Math.max(10, sessionContext.width - (compact() ? 8 : narrow() ? 18 : 32)))

  return (
    <box flexShrink={0} flexDirection="column">
      {/* Title Bar */}
      <box
        paddingTop={sessionContext.verticalMode === "normal" ? 1 : 0}
        paddingBottom={sessionContext.verticalMode === "normal" ? 1 : 0}
        paddingLeft={compact() ? 1 : 2}
        paddingRight={1}
        {...SplitBorder}
        border={["left"]}
        borderColor={theme.border}
        flexShrink={0}
        backgroundColor={theme.backgroundPanel}
      >
        <Switch>
          <Match when={session()?.parentID}>
            <box flexDirection="row" gap={compact() ? 1 : 2}>
              <text fg={theme.text}>
                <b>{compact() ? "Subagent" : "Subagent session"}</b>
              </text>
              <text fg={theme.text}>
                Parent <span style={{ fg: theme.textMuted }}>{keybind.print("session_parent")}</span>
              </text>
              <Show when={!narrow()}>
                <text fg={theme.text}>
                  Prev <span style={{ fg: theme.textMuted }}>{keybind.print("session_child_cycle_reverse")}</span>
                </text>
                <text fg={theme.text}>
                  Next <span style={{ fg: theme.textMuted }}>{keybind.print("session_child_cycle")}</span>
                </text>
              </Show>
              <box flexGrow={1} flexShrink={1} />
              <Show when={!narrow()}>
                <ContextInfo context={context} cost={cost} />
              </Show>
              <AgentToggleButton compact={compact()} />
            </box>
          </Match>
          <Match when={true}>
            <box flexDirection="row" justifyContent="space-between" gap={1}>
              <Title session={session} width={titleWidth()} />
              <box flexDirection="row" gap={1}>
                <Show when={!narrow()}>
                  <ContextInfo context={context} cost={cost} />
                </Show>
                <AgentToggleButton compact={compact()} />
              </box>
            </box>
          </Match>
        </Switch>
      </box>

      {/* Chain Progress Bar - Below Title */}
      <ChainProgressBar chain={chainCtx.getChain(session().id)} />
    </box>
  )
}
