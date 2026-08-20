import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { map, pipe, sortBy } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "../context/sdk"
import { DialogPrompt } from "../ui/dialog-prompt"
import { Link } from "../ui/link"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import type { ProviderAuthAuthorization } from "@atomcli/sdk/v2"
import { DialogModel } from "./dialog-model"
import { useKeyboard } from "@opentui/solid"
import { Clipboard } from "@tui/util/clipboard"
import { useToast } from "../ui/toast"
import { createStore } from "solid-js/store"

const PROVIDER_PRIORITY: Record<string, number> = {
  atomcli: 0,
  ollama: 1,
  anthropic: 2,
  "github-copilot": 3,
  openai: 4,
  google: 5,
}

export function createDialogProviderOptions() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const options = createMemo(() => {
    const providerOptions = pipe(
      sync.data.provider_next.all,
      sortBy((x) => PROVIDER_PRIORITY[x.id] ?? 99),
      map((provider) => ({
        title: provider.name,
        value: provider.id,
        description: {
          atomcli: "(Recommended)",
          ollama: "(Local models - No API key)",
          anthropic: "(Claude Max or API key)",
          openai: "(ChatGPT Plus/Pro or API key)",
        }[provider.id],
        category: provider.id in PROVIDER_PRIORITY ? "Popular" : "More",
        async onSelect() {
          if (provider.id === "atomcli") {
            await sdk.client.auth.set({
              providerID: provider.id,
              auth: { type: "api", key: "public" },
            })
            await sdk.client.instance.dispose()
            await sync.bootstrap()
            dialog.replace(() => <DialogModel providerID={provider.id} />)
            return
          }

          // Ollama - local provider, no API key needed
          if (provider.id === "ollama") {
            await sdk.client.auth.set({
              providerID: provider.id,
              auth: { type: "api", key: "ollama" },
            })
            await sdk.client.instance.dispose()
            await sync.bootstrap()
            dialog.replace(() => <DialogModel providerID={provider.id} />)
            return
          }

          const methods = sync.data.provider_auth[provider.id] ?? [
            {
              type: "api",
              label: "API key",
            },
          ]
          let index: number | null = 0
          if (methods.length > 1) {
            index = await new Promise<number | null>((resolve) => {
              dialog.replace(
                () => (
                  <DialogSelect
                    title="Select auth method"
                    options={methods.map((x, index) => ({
                      title: x.label,
                      value: index,
                    }))}
                    onSelect={(option) => resolve(option.value)}
                  />
                ),
                () => resolve(null),
              )
            })
          }
          if (index == null) return
          const method = methods[index]
          if (method.type === "oauth") {
            const result = await sdk.client.provider.oauth.authorize({
              providerID: provider.id,
              method: index,
            })
            if (result.data?.method === "code") {
              dialog.replace(() => (
                <CodeMethod providerID={provider.id} title={method.label} index={index} authorization={result.data!} />
              ))
            }
            if (result.data?.method === "auto") {
              dialog.replace(() => (
                <AutoMethod providerID={provider.id} title={method.label} index={index} authorization={result.data!} />
              ))
            }
          }
          if (method.type === "api") {
            return dialog.replace(() => <ApiMethod providerID={provider.id} title={method.label} />)
          }
        },
      })),
    )

    // Append the "Custom Provider" entry at the end under its own category
    return [
      ...providerOptions,
      {
        title: "Custom Provider",
        value: "__custom__",
        description: "(OpenAI-compatible endpoint)",
        category: "Custom",
        onSelect() {
          dialog.replace(() => <CustomProviderSetup />)
        },
      },
    ]
  })
  return options
}

export function DialogProvider() {
  const options = createDialogProviderOptions()
  return <DialogSelect title="Connect a provider" options={options()} />
}

interface AutoMethodProps {
  index: number
  providerID: string
  title: string
  authorization: ProviderAuthAuthorization
}
function AutoMethod(props: AutoMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()

  useKeyboard((evt) => {
    if (evt.name === "c" && !evt.ctrl && !evt.meta) {
      const code = props.authorization.instructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4}/)?.[0] ?? props.authorization.url
      Clipboard.copy(code)
        .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
        .catch(toast.error)
    }
  })

  onMount(async () => {
    const result = await sdk.client.provider.oauth.callback({
      providerID: props.providerID,
      method: props.index,
    })
    if (result.error) {
      dialog.clear()
      return
    }
    await sdk.client.instance.dispose()
    await sync.bootstrap()
    dialog.replace(() => <DialogModel providerID={props.providerID} />)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <box gap={1}>
        <Link href={props.authorization.url} fg={theme.primary} />
        <text fg={theme.textMuted}>{props.authorization.instructions}</text>
      </box>
      <text fg={theme.textMuted}>Waiting for authorization...</text>
      <text fg={theme.text}>
        c <span style={{ fg: theme.textMuted }}>copy</span>
      </text>
    </box>
  )
}

interface CodeMethodProps {
  index: number
  title: string
  providerID: string
  authorization: ProviderAuthAuthorization
}
function CodeMethod(props: CodeMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const [error, setError] = createSignal(false)

  return (
    <DialogPrompt
      title={props.title}
      placeholder="Authorization code"
      onConfirm={async (value) => {
        const { error } = await sdk.client.provider.oauth.callback({
          providerID: props.providerID,
          method: props.index,
          code: value,
        })
        if (!error) {
          await sdk.client.instance.dispose()
          await sync.bootstrap()
          dialog.replace(() => <DialogModel providerID={props.providerID} />)
          return
        }
        setError(true)
      }}
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>{props.authorization.instructions}</text>
          <Link href={props.authorization.url} fg={theme.primary} />
          <Show when={error()}>
            <text fg={theme.error}>Invalid code</text>
          </Show>
        </box>
      )}
    />
  )
}

interface ApiMethodProps {
  providerID: string
  title: string
}
function ApiMethod(props: ApiMethodProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title={props.title}
      placeholder="API key"
      description={
        props.providerID === "atomcli" ? (
          <box gap={1}>
            <text fg={theme.textMuted}>AtomCLI gives you access to powerful coding models.</text>
          </box>
        ) : undefined
      }
      onConfirm={async (value) => {
        if (!value) return
        sdk.client.auth.set({
          providerID: props.providerID,
          auth: {
            type: "api",
            key: value,
          },
        })
        await sdk.client.instance.dispose()
        await sync.bootstrap()
        dialog.replace(() => <DialogModel providerID={props.providerID} />)
      }}
    />
  )
}

// ─── Custom Provider Setup ────────────────────────────────────────────────────
// Multi-step wizard: ID → Name → Base URL → API Key → discover models → save

type CustomStep = "id" | "name" | "url" | "apikey" | "discovering" | "fallback-model"

function CustomProviderSetup() {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()

  const [form, setForm] = createStore({
    step: "id" as CustomStep,
    providerID: "",
    name: "",
    baseURL: "",
    apiKey: "",
    discoveryError: "",
    models: {} as Record<string, any>,
  })

  async function runDiscovery() {
    setForm("step", "discovering")
    const baseUrl = sdk.url.replace(/\/$/, "")
    const resp = await fetch(`${baseUrl}/provider/custom/discover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseURL: form.baseURL, apiKey: form.apiKey || undefined }),
    }).catch(() => null)

    const result: {
      ok: boolean
      models: Array<{
        id: string
        name: string
        tool_call: boolean
        reasoning: boolean
        attachment: boolean
        temperature: boolean
        limit: { context: number; output: number }
      }>
      error?: string
    } | null = resp?.ok ? await resp.json().catch(() => null) : null

    if (result?.ok && result.models.length > 0) {
      const modelsConfig: Record<string, any> = {}
      for (const m of result.models) {
        modelsConfig[m.id] = {
          name: m.name,
          tool_call: m.tool_call,
          reasoning: m.reasoning,
          attachment: m.attachment,
          temperature: m.temperature,
          limit: m.limit,
        }
      }
      setForm("models", modelsConfig)
      await saveAndFinish(modelsConfig)
    } else {
      setForm("discoveryError", result?.error ?? "Empty model list")
      setForm("step", "fallback-model")
    }
  }

  async function saveAndFinish(models: Record<string, any>) {
    const baseUrl = sdk.url.replace(/\/$/, "")
    await fetch(`${baseUrl}/provider/custom/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerID: form.providerID,
        name: form.name,
        baseURL: form.baseURL,
        apiKey: form.apiKey || undefined,
        models,
      }),
    }).catch(() => null)
    await sdk.client.instance.dispose()
    await sync.bootstrap()
    dialog.replace(() => <DialogModel providerID={form.providerID} />)
  }

  return (
    <Show
      when={form.step !== "discovering"}
      fallback={
        <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
          <box flexDirection="row" justifyContent="space-between">
            <text attributes={TextAttributes.BOLD} fg={theme.text}>
              Custom Provider
            </text>
            <text fg={theme.textMuted}>esc</text>
          </box>
          <text fg={theme.textMuted}>Discovering models from {form.baseURL}...</text>
        </box>
      }
    >
      <Show when={form.step === "id"}>
        <DialogPrompt
          title="Custom Provider — Provider ID"
          placeholder="e.g. my-llm, 9route, local-gateway"
          onConfirm={(value) => {
            const id = value.trim().replace(/^@ai-sdk\//, "")
            if (!id || !/^[0-9a-z-]+$/.test(id)) return
            setForm("providerID", id)
            const defaultName = id.charAt(0).toUpperCase() + id.slice(1)
            setForm("name", defaultName)
            setForm("step", "name")
          }}
        />
      </Show>

      <Show when={form.step === "name"}>
        <DialogPrompt
          title="Custom Provider — Display Name"
          placeholder={form.name}
          value={form.name}
          onConfirm={(value) => {
            setForm("name", (value && value.trim()) || form.name)
            setForm("step", "url")
          }}
        />
      </Show>

      <Show when={form.step === "url"}>
        <DialogPrompt
          title="Custom Provider — Base URL"
          placeholder="e.g. http://localhost:11434/v1"
          onConfirm={(value) => {
            const url = value.trim().replace(/\/+$/, "")
            if (!url) return
            try {
              new URL(url)
            } catch {
              return
            }
            setForm("baseURL", url)
            setForm("step", "apikey")
          }}
        />
      </Show>

      <Show when={form.step === "apikey"}>
        <DialogPrompt
          title="Custom Provider — API Key (optional)"
          placeholder="Leave blank if not required"
          onConfirm={(value) => {
            setForm("apiKey", value ? value.trim() : "")
            runDiscovery()
          }}
        />
      </Show>

      <Show when={form.step === "fallback-model"}>
        <DialogPrompt
          title="Custom Provider — Default Model"
          placeholder="e.g. gpt-4o, llama-3.3-70b"
          description={() => (
            <box gap={1}>
              <text fg={theme.textMuted}>Could not auto-discover models: {form.discoveryError}</text>
              <text fg={theme.textMuted}>Enter a model name to use this provider.</text>
            </box>
          )}
          onConfirm={async (value) => {
            const modelId = value.trim()
            if (!modelId) return
            const models: Record<string, any> = {
              [modelId]: {
                name: modelId,
                tool_call: true,
                limit: { context: 128000, output: 8192 },
              },
            }
            await saveAndFinish(models)
          }}
        />
      </Show>
    </Show>
  )
}
