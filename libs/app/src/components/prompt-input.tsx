import { Component, createMemo, createEffect, on } from "solid-js"
import { createStore } from "solid-js/store"
import { createFocusSignal } from "@solid-primitives/active-element"
import { useLocal } from "@/context/local"
import { useFile } from "@/context/file"
import {
  Prompt,
  usePrompt,
  ImageAttachmentPart,
} from "@/context/prompt"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useNavigate, useParams } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { useDialog } from "@atomcli/ui/context/dialog"
import { useProviders } from "@/hooks/use-providers"
import { useCommand } from "@/context/command"
import { Identifier } from "@/utils/id"
import { useGlobalSync } from "@/context/global-sync"
import { usePlatform } from "@/context/platform"
import { createAtomcliClient } from "@atomcli/sdk/v2/client"
import { showToast } from "@atomcli/ui/toast"
import { base64Encode } from "@atomcli/util/encode"
import { PLACEHOLDERS } from "./prompt/constants"
import { usePromptHistory } from "./prompt/hooks/usePromptHistory"
import {
  setCursorPosition,
  scrollCursorIntoView,
  promptLength,
} from "./prompt/utils"
import { PromptInputProps } from "./prompt/types"
import { PromptEditor } from "./prompt/prompt-editor"
import { PromptActions } from "./prompt/prompt-actions"

export const PromptInput: Component<PromptInputProps> = (props) => {
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const globalSync = useGlobalSync()
  const platform = usePlatform()
  const local = useLocal()
  const files = useFile()
  const prompt = usePrompt()
  const layout = useLayout()
  const params = useParams()
  const dialog = useDialog()
  const providers = useProviders()
  const command = useCommand()

  let editorRef!: HTMLDivElement
  let fileInputRef!: HTMLInputElement
  let scrollRef!: HTMLDivElement

  const queueScroll = () => {
    requestAnimationFrame(() => scrollCursorIntoView(scrollRef, editorRef))
  }

  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const tabs = createMemo(() => layout.tabs(sessionKey()))
  const activeFile = createMemo(() => {
    const tab = tabs().active()
    if (!tab) return
    return files.pathFromTab(tab)
  })
  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const status = createMemo(
    () =>
      sync.data.session_status[params.id ?? ""] ?? {
        type: "idle",
      },
  )
  const working = createMemo(() => status()?.type !== "idle")
  const imageAttachments = createMemo(
    () => prompt.current().filter((part) => part.type === "image") as ImageAttachmentPart[],
  )

  const [store, setStore] = createStore<{
    popover: "at" | "slash" | null
    placeholder: number
    mode: "normal" | "shell"
    historyIndex?: number
    savedPrompt?: Prompt | null
    applyingHistory?: boolean
    dragging?: boolean
  }>({
    popover: null,
    placeholder: Math.floor(Math.random() * PLACEHOLDERS.length),
    mode: "normal",
  })

  const history = usePromptHistory()
  const isFocused = createFocusSignal(() => editorRef)

  createEffect(() => {
    // Sync popover state from PromptEditor if possible?
    // Or just let PromptEditor handle it.
    // If popover is managed by editor internally, we can ignore it here?
    // But PromptActions passed inputs via props might need it? 
    // PromptActions only needs 'store.mode'.
    // PromptEditor updates store.popover.
    // So if we pass 'store' and 'setStore' to PromptEditor, it works.
  })

  // Ensure dragging state is managed. 
  // PromptEditor updates store.dragging via createEffect.

  const abort = () =>
    sdk.client.session
      .abort({ sessionID: params.id! })
      .catch(() => { })

  const handleSubmit = async (event: Event) => {
    event.preventDefault()

    const currentPrompt = prompt.current()
    const text = currentPrompt.map((p) => ("content" in p ? p.content : "")).join("")
    const images = imageAttachments().slice()
    const mode = store.mode

    if (text.trim().length === 0 && images.length === 0) {
      if (working()) abort()
      return
    }

    const currentModel = local.model.current()
    const currentAgent = local.agent.current()
    if (!currentModel || !currentAgent) {
      showToast({
        title: "Select an agent and model",
        description: "Choose an agent and model before sending a prompt.",
      })
      return
    }

    const errorMessage = (err: unknown) => {
      if (err && typeof err === "object" && "data" in err) {
        const data = (err as { data?: { message?: string } }).data
        if (data?.message) return data.message
      }
      if (err instanceof Error) return err.message
      return "Request failed"
    }

    history.add(currentPrompt, mode)
    history.reset()

    const projectDirectory = sdk.directory
    const isNewSession = !params.id
    const worktreeSelection = props.newSessionWorktree ?? "main"

    let sessionDirectory = projectDirectory
    let client = sdk.client

    if (isNewSession) {
      if (worktreeSelection === "create") {
        const createdWorktree = await client.worktree
          .create({ directory: projectDirectory })
          .then((x) => x.data)
          .catch((err) => {
            showToast({
              title: "Failed to create worktree",
              description: errorMessage(err)
            })
            return undefined
          })

        if (!createdWorktree?.directory) {
          showToast({
            title: "Failed to create worktree",
            description: "Request failed"
          })
          return
        }
        sessionDirectory = createdWorktree.directory
      }

      if (worktreeSelection !== "main" && worktreeSelection !== "create") {
        sessionDirectory = worktreeSelection
      }

      if (sessionDirectory !== projectDirectory) {
        client = createAtomcliClient({
          baseUrl: sdk.url,
          fetch: platform.fetch,
          directory: sessionDirectory,
          throwOnError: true,
        })
        globalSync.child(sessionDirectory)
      }

      props.onNewSessionWorktreeReset?.()
    }

    let session = info()
    if (!session && isNewSession) {
      session = await client.session.create().then((x) => x.data ?? undefined)
      if (session) navigate(`/${base64Encode(sessionDirectory)}/session/${session.id}`)
    }
    if (!session) return

    const model = {
      modelID: currentModel.id,
      providerID: currentModel.provider.id,
    }
    const agent = currentAgent.name
    const variant = local.model.variant.current()

    const clearInput = () => {
      prompt.reset()
      setStore("mode", "normal")
      setStore("popover", null)
    }

    const restoreInput = () => {
      prompt.set(currentPrompt, promptLength(currentPrompt))
      setStore("mode", mode)
      setStore("popover", null)
      requestAnimationFrame(() => {
        if (editorRef) {
          editorRef.focus()
          setCursorPosition(editorRef, promptLength(currentPrompt))
          queueScroll()
        }
      })
    }

    if (mode === "shell") {
      clearInput()
      client.session
        .shell({
          sessionID: session.id,
          agent,
          model,
          command: text,
        })
        .catch((err) => {
          showToast({
            title: "Failed to send shell command",
            description: errorMessage(err)
          })
          restoreInput()
        })
      return
    }

    if (text.startsWith("/")) {
      const [cmdName, ...args] = text.split(" ")
      const commandName = cmdName.slice(1)
      const customCommand = sync.data.command.find((c) => c.name === commandName)
      if (customCommand) {
        clearInput()
        client.session
          .command({
            sessionID: session.id,
            command: commandName,
            arguments: args.join(" "),
            agent,
            model: `${model.providerID}/${model.modelID}`,
            variant,
            parts: images.map((attachment) => ({
              id: Identifier.ascending("part"),
              type: "file" as const,
              mime: attachment.mime,
              data: attachment.data,
            })),
          })
          .catch((err) => {
            showToast({
              title: "Failed to run command",
              description: errorMessage(err)
            })
            restoreInput()
          })
        return
      }
    }

    clearInput()

    const requestParts = []
    for (const image of images) {
      requestParts.push({
        type: "file" as const,
        mime: image.mime,
        data: image.data,
      })
    }
    if (text) {
      requestParts.push({ type: "text" as const, text })
    }

    client.session.prompt({
      sessionID: session.id,
      agent,
      model,
      parts: requestParts,
      variant,
    }).catch(err => {
      showToast({ title: "Failed", description: errorMessage(err) })
      restoreInput()
    })
  }

  return (
    <div class="relative size-full _max-h-[320px] flex flex-col gap-3">
      <form
        onSubmit={handleSubmit}
        classList={{
          "group/prompt-input": true,
          "bg-surface-raised-stronger-non-alpha shadow-xs-border relative": true,
          "rounded-md overflow-clip focus-within:shadow-xs-border": true,
          "border-icon-info-active border-dashed": store.dragging,
          [props.class ?? ""]: !!props.class,
        }}
      >
        <PromptEditor
          store={store}
          setStore={setStore}
          history={history}
          working={working()}
          abort={abort}
          handleSubmit={handleSubmit}
          imageAttachments={imageAttachments()}
          activeFile={activeFile()}
          isFocused={isFocused}
          setRef={(el) => editorRef = el}
          setScrollRef={(el) => scrollRef = el}
          queueScroll={queueScroll}
        />
        <PromptActions
          mode={store.mode}
          working={working()}
          promptDirty={prompt.dirty()}
          fileInputRef={fileInputRef}
          onStop={abort}
          onSend={() => { /* triggered by submit */ }}
          paramsId={params.id}
        />
      </form>
    </div>
  )
}
