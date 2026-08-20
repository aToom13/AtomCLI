import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createMemo, createSignal, Match, onMount, Show, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Logo } from "../component/logo"
import { DidYouKnow, randomizeTip } from "../component/did-you-know"
import { Locale } from "@/util/util/locale"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useDirectory } from "../context/directory"
import { useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { Installation } from "@/services/installation"
import { useKV } from "../context/kv"
import { useCommandDialog } from "../component/dialog-command"
import { useKeybind } from "../context/keybind"
import { useTerminalDimensions } from "@opentui/solid"
import { UI } from "@/interfaces/cli/ui"

let cliPromptSubmitted = false

export function Home() {
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const command = useCommandDialog()
  const keybind = useKeybind()
  const dimensions = useTerminalDimensions()
  const [autocompleteVisible, setAutocompleteVisible] = createSignal(false)
  const mcp = createMemo(() => Object.keys(sync.data.mcp).length > 0)
  const mcpAttentionCount = createMemo(() => {
    return Object.values(sync.data.mcp).filter((x) =>
      ["failed", "needs_auth", "needs_client_registration"].includes(x.status),
    ).length
  })
  const mcpNeedsAttention = createMemo(() => mcpAttentionCount() > 0)

  const connectedMcpCount = createMemo(() => {
    return Object.values(sync.data.mcp).filter((x) => x.status === "connected").length
  })

  const isFirstTimeUser = createMemo(() => sync.status === "complete" && sync.data.session.length === 0)
  const tipsHidden = createMemo(() => kv.get("tips_hidden", false))
  const showTips = createMemo(() => {
    // Don't show tips for first-time users
    if (isFirstTimeUser()) return false
    if (dimensions().width < 90 || dimensions().height < 24) return false
    return !tipsHidden()
  })

  command.register(() => [
    {
      title: tipsHidden() ? "Show tips" : "Hide tips",
      value: "tips.toggle",
      keybind: "tips_toggle",
      category: "System",
      onSelect: (dialog) => {
        kv.set("tips_hidden", !tipsHidden())
        dialog.clear()
      },
    },
  ])

  const Hint = (
    <Show when={connectedMcpCount() > 0 || mcpNeedsAttention()}>
      <box flexShrink={0} flexDirection="row" gap={1}>
        <text fg={theme.text}>
          <Switch>
            <Match when={mcpNeedsAttention()}>
              <span style={{ fg: theme.error }}>•</span>{" "}
              {Locale.pluralize(mcpAttentionCount(), "{} MCP server needs attention", "{} MCP servers need attention")}{" "}
              <span style={{ fg: theme.textMuted }}>{keybind.print("status_view")}</span>
            </Match>
            <Match when={true}>
              <span style={{ fg: theme.success }}>•</span>{" "}
              {Locale.pluralize(connectedMcpCount(), "{} mcp server", "{} mcp servers")}
            </Match>
          </Switch>
        </text>
      </box>
    </Show>
  )

  let prompt: PromptRef
  const args = useArgs()
  onMount(() => {
    randomizeTip()
    if (route.initialPrompt) {
      prompt.set(route.initialPrompt)
    } else if (args.prompt && !cliPromptSubmitted) {
      prompt.set({ input: args.prompt, parts: [] })
      cliPromptSubmitted = true
      prompt.submit()
    }
  })
  const directory = useDirectory()

  return (
    <>
      <box flexGrow={1} justifyContent="center" alignItems="center" paddingLeft={2} paddingRight={2} gap={1}>
        <box minHeight={dimensions().width >= UI.Logo.width + 4 ? UI.Logo.left.length : 1}>
          <Show when={!autocompleteVisible()}>
            <Logo />
          </Show>
        </box>
        <box width="100%" maxWidth={75} zIndex={1000} paddingTop={1}>
          <Prompt
            ref={(r) => {
              prompt = r
              promptRef.set(r)
            }}
            hint={Hint}
            onAutocompleteChange={(visible) => setAutocompleteVisible(!!visible)}
          />
        </box>
        <Show when={isFirstTimeUser()}>
          <text fg={theme.textMuted}>Describe what you want to build, fix, or understand. Type / for commands.</text>
        </Show>
        <Toast />
      </box>
      <Show when={!isFirstTimeUser()}>
        <Show when={showTips()}>
          <DidYouKnow />
        </Show>
      </Show>
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexDirection="row" flexShrink={0} gap={2}>
        <box flexGrow={1} overflow="hidden">
          <text fg={theme.textMuted}>{directory()}</text>
        </box>
        <box gap={1} flexDirection="row" flexShrink={0}>
          <Show when={mcp()}>
            <text fg={theme.text}>
              <Switch>
                <Match when={mcpNeedsAttention()}>
                  <span style={{ fg: theme.error }}>⊙ </span>
                </Match>
                <Match when={true}>
                  <span style={{ fg: connectedMcpCount() > 0 ? theme.success : theme.textMuted }}>⊙ </span>
                </Match>
              </Switch>
              <Show
                when={mcpNeedsAttention()}
                fallback={Locale.pluralize(connectedMcpCount(), "{} MCP server", "{} MCP servers")}
              >
                {Locale.pluralize(mcpAttentionCount(), "{} MCP issue", "{} MCP issues")}
              </Show>
            </text>
            <Show when={dimensions().width >= 72}>
              <text fg={theme.textMuted}>/status</text>
            </Show>
          </Show>
        </box>
        <box flexGrow={1} />
        <Show when={dimensions().width >= 50}>
          <box flexShrink={0}>
            <text fg={theme.textMuted}>{Installation.VERSION}</text>
          </box>
        </Show>
      </box>
    </>
  )
}
