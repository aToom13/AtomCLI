import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { Keybind } from "@/util/util/keybind"
import type { Provider } from "@/integrations/provider/provider"
import { ModelAvailability } from "@/integrations/provider/availability"
import * as fuzzysort from "fuzzysort"
import { useTerminalDimensions } from "@opentui/solid"

export namespace ModelDialog {
  export type Billing = "free" | "subscription" | "metered"

  export type Value = {
    providerID: string
    modelID: string
  }

  export function isValue(value: unknown): value is Value {
    if (!value || typeof value !== "object") return false
    const candidate = value as Partial<Value>
    return typeof candidate.providerID === "string" && typeof candidate.modelID === "string"
  }

  export function billing(provider: Pick<Provider.Info, "id">, model: Pick<Provider.Model, "api" | "cost">): Billing {
    const codexSubscription =
      provider.id === "openai" && model.api.url?.includes("chatgpt.com/backend-api/codex") === true
    if (codexSubscription) return "subscription"
    if (model.cost.input === 0 && model.cost.output === 0) return "free"
    return "metered"
  }

  export function isFree(provider: Pick<Provider.Info, "id">, model: Pick<Provider.Model, "api" | "cost">) {
    return billing(provider, model) === "free"
  }

  export function statusLabel(
    provider: Pick<Provider.Info, "id">,
    model: Pick<Provider.Model, "api" | "cost" | "status" | "availability">,
  ) {
    const availability = ModelAvailability.active(model.availability)
    if (availability?.status === "rate_limited") return "RATE LIMITED"
    if (availability?.status === "unavailable") return "UNAVAILABLE"
    const kind = billing(provider, model)
    if (kind === "free") return "FREE"
    if (kind === "subscription") return "SUBSCRIPTION"
    return (model.status ?? "active").toUpperCase()
  }

  export function formatTokens(value: number) {
    if (!value) return "—"
    if (value >= 1_000_000) {
      const amount = value / 1_000_000
      return `${Number.isInteger(amount) ? amount : amount.toFixed(1)}M`
    }
    if (value >= 1_000) {
      const amount = value / 1_000
      if (amount >= 100) return `${Math.round(amount)}K`
      return `${Number.isInteger(amount) ? amount : amount.toFixed(1)}K`
    }
    return String(value)
  }

  export function formatPrice(value: number) {
    if (value === 0) return "Free"
    if (value < 0.01) return `$${value.toFixed(4)}/M`
    if (value < 1) return `$${value.toFixed(2)}/M`
    return `$${Number.isInteger(value) ? value : value.toFixed(2)}/M`
  }

  export function capabilities(model: Provider.Model) {
    return [
      model.capabilities.reasoning ? "reasoning" : undefined,
      model.capabilities.toolcall ? "tools" : undefined,
      model.capabilities.input.image ? "images" : undefined,
      model.capabilities.input.pdf ? "pdf" : undefined,
      model.capabilities.input.audio ? "audio" : undefined,
      model.capabilities.input.video ? "video" : undefined,
    ].filter((item): item is string => Boolean(item))
  }

  export function keywords(provider: Provider.Info, model: Provider.Model) {
    const kind = billing(provider, model)
    return [
      provider.id,
      provider.name,
      model.id,
      model.name,
      model.family,
      model.status,
      ModelAvailability.active(model.availability)?.status === "rate_limited" ? "rate limited kota limit sınırlı" : undefined,
      ModelAvailability.active(model.availability)?.status === "unavailable" ? "unavailable kullanılamaz erişilemiyor" : undefined,
      ...capabilities(model),
      kind === "free"
        ? "free ücretsiz"
        : kind === "subscription"
          ? "subscription plan paid abonelik ücretli"
          : "paid metered ücretli",
      `${formatTokens(model.limit.context)} context`,
    ]
      .filter(Boolean)
      .join(" ")
  }
}

type ModelOption = DialogSelectOption<ModelDialog.Value | string>

export function useConnected() {
  const sync = useSync()
  return createMemo(() =>
    sync.data.provider.some((x) => x.id !== "atomcli" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )
}

function ModelDetails(props: { value?: ModelDialog.Value }) {
  const sync = useSync()
  const local = useLocal()
  const { theme } = useTheme()

  const entry = createMemo(() => {
    if (!props.value) return
    const provider = sync.data.provider.find((item) => item.id === props.value!.providerID)
    const model = provider?.models[props.value.modelID]
    if (!provider || !model) return
    return { provider, model }
  })

  const favorite = createMemo(() => {
    if (!props.value) return false
    return local.model
      .favorite()
      .some((item) => item.providerID === props.value!.providerID && item.modelID === props.value!.modelID)
  })

  return (
    <Show
      when={entry()}
      fallback={<text fg={theme.textMuted}>Select a provider to connect and browse its models.</text>}
    >
      {(selected) => (
        <box border={["top"]} borderColor={theme.border} paddingTop={1} gap={1}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              {favorite() ? "★ " : ""}
              {selected().model.name}
            </text>
            <text
              fg={
                ModelAvailability.active(selected().model.availability)
                  ? theme.warning
                  : ModelDialog.billing(selected().provider, selected().model) === "free"
                  ? theme.success
                  : ModelDialog.billing(selected().provider, selected().model) === "subscription"
                    ? theme.secondary
                    : theme.textMuted
              }
            >
              {ModelDialog.statusLabel(selected().provider, selected().model)}
            </text>
          </box>
          <text fg={theme.textMuted}>
            {selected().provider.id}/{selected().model.id}
            <Show when={selected().model.family}> · {selected().model.family}</Show>
          </text>
          <Show when={ModelAvailability.active(selected().model.availability)}>
            <text fg={theme.warning}>
              {selected().model.availability?.status === "rate_limited"
                ? "Temporarily rate limited by the upstream gateway"
                : "The upstream gateway reports this model as unavailable"} · {ModelAvailability.retryLabel(selected().model.availability)}
            </text>
          </Show>
          <box flexDirection="row" flexWrap="wrap" gap={2}>
            <text fg={theme.text}>
              Context{" "}
              <span style={{ fg: theme.accent }}>{ModelDialog.formatTokens(selected().model.limit.context)}</span>
            </text>
            <text fg={theme.text}>
              Output <span style={{ fg: theme.accent }}>{ModelDialog.formatTokens(selected().model.limit.output)}</span>
            </text>
            <Show
              when={ModelDialog.billing(selected().provider, selected().model) === "subscription"}
              fallback={
                <>
                  <text fg={theme.text}>
                    Input{" "}
                    <span style={{ fg: theme.textMuted }}>{ModelDialog.formatPrice(selected().model.cost.input)}</span>
                  </text>
                  <text fg={theme.text}>
                    Output{" "}
                    <span style={{ fg: theme.textMuted }}>{ModelDialog.formatPrice(selected().model.cost.output)}</span>
                  </text>
                </>
              }
            >
              <text fg={theme.text}>
                Access <span style={{ fg: theme.secondary }}>ChatGPT subscription</span>
              </text>
            </Show>
          </box>
          <box flexDirection="row" flexWrap="wrap" gap={1}>
            <For each={ModelDialog.capabilities(selected().model)}>
              {(capability) => <text fg={theme.secondary}>[{capability}]</text>}
            </For>
            <Show when={ModelDialog.capabilities(selected().model).length === 0}>
              <text fg={theme.textMuted}>No special capabilities reported</text>
            </Show>
          </box>
        </box>
      )}
    </Show>
  )
}

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const [query, setQuery] = createSignal("")
  const [showFreeOnly, setShowFreeOnly] = createSignal(false)
  const [showReasoningOnly, setShowReasoningOnly] = createSignal(false)

  onMount(() => dialog.setSize("large"))

  const connected = useConnected()
  const providerActions = createDialogProviderOptions()
  const provider = createMemo(() =>
    props.providerID ? sync.data.provider.find((item) => item.id === props.providerID) : undefined,
  )

  const models = createMemo(() =>
    sync.data.provider.flatMap((provider) =>
      Object.values(provider.models)
        .filter((model) => model.status !== "deprecated")
        .filter((model) => !props.providerID || provider.id === props.providerID)
        .map((model) => ({ provider, model })),
    ),
  )

  function modelOption(
    item: { provider: Provider.Info; model: Provider.Model },
    category: string,
    favorite = false,
  ): ModelOption {
    const value = { providerID: item.provider.id, modelID: item.model.id }
    const detail = [
      favorite ? "★ favorite" : undefined,
      item.model.name !== item.model.id ? item.model.id : undefined,
      item.model.family || undefined,
    ]
      .filter(Boolean)
      .join(" · ")
    const billing = ModelDialog.billing(item.provider, item.model)
    const badges = [
      ModelAvailability.active(item.model.availability)
        ? "RATE LIMITED"
        : billing === "free"
          ? "FREE"
          : billing === "subscription"
            ? "PLAN"
            : undefined,
      item.model.capabilities.reasoning ? "THINK" : undefined,
      ModelDialog.formatTokens(item.model.limit.context),
    ].filter(Boolean)

    return {
      value,
      title: item.model.name || item.model.id,
      description: detail || undefined,
      keywords: ModelDialog.keywords(item.provider, item.model),
      category,
      footer: badges.join("  "),
      onSelect() {
        dialog.clear()
        local.model.set(value, { recent: true })
      },
    }
  }

  const options = createMemo<ModelOption[]>(() => {
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()
    const needle = query().trim()
    const showSections = connected() && !props.providerID && needle.length === 0

    const find = (value: ModelDialog.Value) =>
      models().find((item) => item.provider.id === value.providerID && item.model.id === value.modelID)
    const same = (left: ModelDialog.Value, right: ModelDialog.Value) =>
      left.providerID === right.providerID && left.modelID === right.modelID

    const favoriteOptions = showSections
      ? favorites.flatMap((value) => {
          const item = find(value)
          return item ? [modelOption(item, "★ Favorites", true)] : []
        })
      : []

    const visibleRecents = showSections ? recents.filter((value) => !favorites.some((item) => same(item, value))) : []
    const recentOptions = visibleRecents.flatMap((value) => {
      const item = find(value)
      return item ? [modelOption(item, "Recent")] : []
    })

    const providerOptions = models()
      .filter((item) => {
        if (!showSections) return true
        const value = { providerID: item.provider.id, modelID: item.model.id }
        return !favorites.some((saved) => same(saved, value)) && !visibleRecents.some((saved) => same(saved, value))
      })
      .sort((left, right) => {
        if (left.provider.id === "atomcli" && right.provider.id !== "atomcli") return -1
        if (right.provider.id === "atomcli" && left.provider.id !== "atomcli") return 1
        if (left.provider.name !== right.provider.name) return left.provider.name.localeCompare(right.provider.name)
        if (ModelDialog.isFree(left.provider, left.model) !== ModelDialog.isFree(right.provider, right.model)) {
          return ModelDialog.isFree(left.provider, left.model) ? -1 : 1
        }
        return left.model.name.localeCompare(right.model.name)
      })
      .map((item) =>
        modelOption(
          item,
          props.providerID ? "Available models" : connected() ? item.provider.name : "Available models",
          favorites.some((value) => value.providerID === item.provider.id && value.modelID === item.model.id),
        ),
      )

    const popularProviders: ModelOption[] = !connected()
      ? providerActions()
          .slice(0, 6)
          .map((option) => ({
            ...option,
            category: "Connect a provider",
            keywords: `${option.title} provider connect`,
          }))
      : []

    let result = [...favoriteOptions, ...recentOptions, ...providerOptions, ...popularProviders]
    if (showFreeOnly()) {
      result = result.filter((option) => {
        if (!ModelDialog.isValue(option.value)) return false
        const item = find(option.value)
        return item ? ModelDialog.isFree(item.provider, item.model) : false
      })
    }
    if (showReasoningOnly()) {
      result = result.filter((option) => {
        if (!ModelDialog.isValue(option.value)) return false
        return find(option.value)?.model.capabilities.reasoning === true
      })
    }
    if (needle) {
      result = fuzzysort
        .go(needle, result, { keys: ["title", "category", "description", "keywords"] })
        .map((match) => match.obj)
    }
    return result
  })

  const visibleModels = createMemo(() => options().filter((option) => ModelDialog.isValue(option.value)).length)
  const activeProviderCount = createMemo(() => new Set(models().map((item) => item.provider.id)).size)
  const showDetails = createMemo(() => dimensions().height >= 36)
  const showProviderCount = createMemo(() => dimensions().width >= 72)

  return (
    <DialogSelect<ModelDialog.Value | string>
      title={provider() ? `${provider()!.name} models` : "Models"}
      description={
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.textMuted}>
            {visibleModels()} of {models().length} models
            <Show when={showProviderCount()}> · {activeProviderCount()} providers</Show> · for{" "}
            {local.agent.current().name}
          </text>
          <box flexDirection="row" gap={1}>
            <Show when={showFreeOnly()}>
              <text fg={theme.success}>[free]</text>
            </Show>
            <Show when={showReasoningOnly()}>
              <text fg={theme.accent}>[reasoning]</text>
            </Show>
          </box>
        </box>
      }
      placeholder="Search name, ID, provider or capability"
      emptyMessage="No models match your search and filters"
      keybind={[
        {
          keybind: Keybind.parse("ctrl+a")[0],
          title: connected() ? "providers" : "connect",
          onTrigger() {
            dialog.replace(() => <DialogProvider />)
          },
        },
        {
          keybind: Keybind.parse("ctrl+f")[0],
          title: "favorite",
          disabled: !connected(),
          onTrigger(option) {
            if (ModelDialog.isValue(option.value)) local.model.toggleFavorite(option.value)
          },
        },
        {
          keybind: Keybind.parse("ctrl+e")[0],
          title: showFreeOnly() ? "all prices" : "free",
          onTrigger: () => setShowFreeOnly((value) => !value),
        },
        {
          keybind: Keybind.parse("ctrl+r")[0],
          title: showReasoningOnly() ? "all types" : "reasoning",
          onTrigger: () => setShowReasoningOnly((value) => !value),
        },
      ]}
      onFilter={setQuery}
      skipFilter={true}
      current={local.model.current()}
      options={options()}
      details={
        showDetails()
          ? (option) => <ModelDetails value={ModelDialog.isValue(option?.value) ? option.value : undefined} />
          : undefined
      }
    />
  )
}
