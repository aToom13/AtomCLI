import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "@tui/context/keybind"
import { useLocal } from "@tui/context/local"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { addDefaultParsers, type ScrollBoxRenderable, RGBA } from "@opentui/core"
import { FileTree } from "@tui/component/file-tree"
import { CodePanel } from "@tui/component/code-panel"
import { useCommandDialog } from "@tui/component/dialog-command"
import parsers from "../../../../../../../parsers-config.ts"
import { Toast, useToast } from "../../ui/toast"
import { useDialog } from "../../ui/dialog"
import { Log } from "@/util/util/log"
import { Sidebar } from "./sidebar"
import { PermissionPrompt } from "./permission"
import { QuestionPrompt } from "./question"
import { Prompt, type PromptRef } from "@tui/component/prompt"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { DialogMessage } from "./dialog-message"
import { useExit } from "../../context/exit"
import { usePromptRef } from "../../context/prompt"
import { SessionContext } from "./context"
import { useSessionState } from "./hooks/useSessionState"
import { useRevert } from "./logic/revert"
import { getSessionCommands } from "./logic/commands"
import { UserMessage } from "./components/UserMessage"
import { AssistantMessage } from "./components/AssistantMessage"
import { Header } from "./header"
import { SplitBorder } from "@tui/component/border"
import { SubAgentPanel } from "./components/SubAgentPanel"
import { useSubAgents } from "@tui/context/subagent"

addDefaultParsers(parsers.parsers)

export function Session() {
  const state = useSessionState()
  const {
    session,
    messages,
    route,
    sync,
    sidebarVisible,
    wide,
    showThinking,
    showAssistantMetadata,
    showDetails,
    showTimestamps,
    diffWrapMode,
    contentWidth,
    conceal,
    scrollAcceleration,
    pending,
    lastAssistant,
    children,
    navigate,
    sidebarOpen,
    autoFollow,
  } = state

  const subAgentCtx = useSubAgents()

  const toast = useToast()
  const sdk = useSDK()
  const promptRef = usePromptRef()
  const keybind = useKeybind()
  const exit = useExit()
  const dialog = useDialog()
  const renderer = useRenderer()
  const { theme } = useTheme()
  const local = useLocal()

  let scroll: ScrollBoxRenderable
  let prompt: PromptRef

  // Effects
  createEffect(async () => {
    await sync.session
      .sync(route.sessionID)
      .then(() => {
        if (scroll && autoFollow()) scroll.scrollBy(100_000)
      })
      .catch((e) => {
        Log.Default.error("session sync failed", { error: e instanceof Error ? e.message : String(e) })
        toast.show({
          message: `Session not found: ${route.sessionID}`,
          variant: "error",
        })
        return navigate({ type: "home" })
      })
  })

  // Handle initial prompt from fork
  createEffect(() => {
    if (route.initialPrompt && prompt) {
      prompt.set(route.initialPrompt)
    }
  })

  // Allow exit when in child session (prompt is hidden)
  useKeyboard(async (evt) => {
    if (!session()?.parentID) return
    if (keybind.match("app_exit", evt)) {
      const confirmed = await DialogConfirm.show(dialog, "Exit AtomCLI?", "Are you sure you want to exit?")
      if (confirmed) {
        exit()
      }
    }
  })

  // Revert Logic
  const revert = useRevert(session, messages)

  // Scroll Helpers
  const findNextVisibleMessage = (direction: "next" | "prev"): string | null => {
    const children = scroll.getChildren()
    const messagesList = messages()
    const scrollTop = scroll.y

    const visibleMessages = children
      .filter((c) => {
        if (!c.id) return false
        const message = messagesList.find((m) => m.id === c.id)
        if (!message) return false
        const parts = sync.data.part[message.id]
        if (!parts || !Array.isArray(parts)) return false
        return parts.some((part) => part && part.type === "text" && !part.synthetic && !part.ignored)
      })
      .sort((a, b) => a.y - b.y)

    if (visibleMessages.length === 0) return null
    if (direction === "next") return visibleMessages.find((c) => c.y > scrollTop + 10)?.id ?? null
    return [...visibleMessages].reverse().find((c) => c.y < scrollTop - 10)?.id ?? null
  }

  const scrollToMessage = (direction: "next" | "prev", d: ReturnType<typeof useDialog>) => {
    const targetID = findNextVisibleMessage(direction)
    if (!targetID) {
      scroll.scrollBy(direction === "next" ? scroll.height : -scroll.height)
      d.clear()
      return
    }
    const child = scroll.getChildren().find((c) => c.id === targetID)
    if (child) scroll.scrollBy(child.y - scroll.y - 1)
    d.clear()
  }

  function toBottom() {
    setTimeout(() => {
      if (scroll) scroll.scrollTo(scroll.scrollHeight)
    }, 50)
  }

  function moveChild(direction: number) {
    if (children().length === 1) return
    let next = children().findIndex((x) => x.id === session()?.id) + direction
    if (next >= children().length) next = 0
    if (next < 0) next = children().length - 1
    if (children()[next]) {
      navigate({
        type: "session",
        sessionID: children()[next].id,
      })
    }
  }

  // Snap to bottom when session changes
  createEffect(on(() => route.sessionID, toBottom))

  // Commands
  const commands = createMemo(() =>
    getSessionCommands(state, {
      navigate,
      toast,
      sdk,
      dialog,
      prompt,
      scroll,
      toBottom,
      scrollToMessage,
      moveChild,
      local,
    }),
  )

  const commandDialog = useCommandDialog()
  commandDialog.register(() => commands() as any)

  const permissions = createMemo(() => {
    if (session()?.parentID) return []
    // Use state.permissions? Yes state has it.
    // Wait, state.permissions is memo.
    // I destructured it? No, I destructured session, messages, etc.
    // I missed permissions and questions in destructure.
    return state.permissions()
  })

  const questions = createMemo(() => state.questions())

  return (
    <SessionContext.Provider
      value={{
        get width() {
          return contentWidth()
        },
        sessionID: route.sessionID,
        conceal,
        showThinking,
        showTimestamps,
        showDetails,
        diffWrapMode,
        sync,
      }}
    >
      <box flexDirection="row">
        {/* Left: File Tree Sidebar */}
        <FileTree />

        {/* Center: Chat Area */}
        <box flexGrow={1} paddingBottom={1} paddingTop={1} paddingLeft={2} paddingRight={2} gap={1}>
          <Show when={session()}>
            <Show when={!sidebarVisible() || !wide()}>
              <Header />
            </Show>
            <scrollbox
              ref={(r) => (scroll = r)}
              viewportOptions={{
                paddingRight: state.showScrollbar() ? 1 : 0,
              }}
              verticalScrollbarOptions={{
                paddingLeft: 1,
                visible: state.showScrollbar(),
                trackOptions: {
                  backgroundColor: theme.backgroundElement,
                  foregroundColor: theme.border,
                },
              }}
              stickyScroll={autoFollow()}
              stickyStart="bottom"
              flexGrow={1}
              scrollAcceleration={scrollAcceleration()}
            >
              <For each={messages()}>
                {(message, index) => (
                  <Switch>
                    {/* Revert Banner */}
                    <Match when={message.id === revert()?.messageID}>
                      {(function () {
                        const command = useCommandDialog()
                        const [hover, setHover] = createSignal(false)
                        const d = useDialog()
                        const handleUnrevert = async () => {
                          const confirmed = await DialogConfirm.show(
                            d,
                            "Confirm Redo",
                            "Are you sure you want to restore the reverted messages?",
                          )
                          if (confirmed) {
                            command.trigger("session.redo")
                          }
                        }
                        return (
                          <box
                            onMouseOver={() => setHover(true)}
                            onMouseOut={() => setHover(false)}
                            onMouseUp={handleUnrevert}
                            marginTop={1}
                            flexShrink={0}
                            border={["left"]}
                            customBorderChars={SplitBorder.customBorderChars}
                            borderColor={theme.backgroundPanel}
                          >
                            <box
                              paddingTop={1}
                              paddingBottom={1}
                              paddingLeft={2}
                              backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
                            >
                              <text fg={theme.textMuted}>{revert()!.reverted.length} message reverted</text>
                              <text fg={theme.textMuted}>
                                <span style={{ fg: theme.text }}>{keybind.print("messages_redo")}</span> or /redo to
                                restore
                              </text>
                              <Show when={revert()!.diffFiles?.length}>
                                <box marginTop={1}>
                                  <For each={revert()!.diffFiles}>
                                    {(file) => (
                                      <text fg={theme.text}>
                                        {file.filename}
                                        <Show when={file.additions > 0}>
                                          <span style={{ fg: theme.diffAdded }}> +{file.additions}</span>
                                        </Show>
                                        <Show when={file.deletions > 0}>
                                          <span style={{ fg: theme.diffRemoved }}> -{file.deletions}</span>
                                        </Show>
                                      </text>
                                    )}
                                  </For>
                                </box>
                              </Show>
                            </box>
                          </box>
                        )
                      })()}
                    </Match>
                    {/* Reverted Messages Hidden */}
                    <Match when={revert()?.messageID && message.id >= revert()!.messageID}>
                      <></>
                    </Match>
                    <Match when={message.role === "user"}>
                      <UserMessage
                        index={index()}
                        onMouseUp={() => {
                          if (renderer.getSelection()?.getSelectedText()) return
                          dialog.replace(() => (
                            <DialogMessage
                              messageID={message.id}
                              sessionID={route.sessionID}
                              setPrompt={(promptInfo) => prompt.set(promptInfo)}
                            />
                          ))
                        }}
                        message={message as any}
                        parts={sync.data.part[message.id] ?? []}
                        pending={pending()}
                      />
                    </Match>
                    <Match when={message.role === "assistant"}>
                      <AssistantMessage
                        last={lastAssistant()?.id === message.id}
                        message={message as any}
                        parts={sync.data.part[message.id] ?? []}
                      />
                    </Match>
                  </Switch>
                )}
              </For>
            </scrollbox>
            <box flexShrink={0}>
              <Show when={permissions().length > 0}>
                <PermissionPrompt request={permissions()[0]} />
              </Show>
              <Show when={permissions().length === 0 && questions().length > 0}>
                <QuestionPrompt request={questions()[0]} />
              </Show>
              <Prompt
                visible={!session()?.parentID && permissions().length === 0 && questions().length === 0}
                ref={(r) => {
                  prompt = r
                  promptRef.set(r)
                  if (route.initialPrompt) {
                    r.set(route.initialPrompt)
                  }
                }}
                disabled={permissions().length > 0 || questions().length > 0}
                onSubmit={() => {
                  toBottom()
                }}
                sessionID={route.sessionID}
              />
            </box>
          </Show>
          <Toast />
        </box>

        {/* Right: Sub-Agent Panel (auto-shows when agents are active) */}
        <SubAgentPanel agents={subAgentCtx.agents()} />

        {/* Right: Code Panel (hides when agents are active) */}
        <Show when={subAgentCtx.agents().length === 0}>
          <CodePanel />
        </Show>

        <Show when={sidebarVisible()}>
          <Switch>
            <Match when={wide()}>
              <Sidebar sessionID={route.sessionID} />
            </Match>
            <Match when={!wide()}>
              <box
                position="absolute"
                top={0}
                left={0}
                right={0}
                bottom={0}
                alignItems="flex-end"
                backgroundColor={RGBA.fromInts(0, 0, 0, 70)}
              >
                <Sidebar sessionID={route.sessionID} />
              </box>
            </Match>
          </Switch>
        </Show>
      </box>
    </SessionContext.Provider>
  )
}
