import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, flatMap, entries, filter, sortBy, take } from "remeda"
import { DialogSelect, type DialogSelectRef } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { Keybind } from "@/util/keybind"
import * as fuzzysort from "fuzzysort"

export function useConnected() {
  const sync = useSync()
  return createMemo(() =>
    sync.data.provider.some((x) => x.id !== "atomcli" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )
}

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const [ref, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [query, setQuery] = createSignal("")
  const [showFreeOnly, setShowFreeOnly] = createSignal(false)

  // Helper to check if a model is free (input cost = 0)
  const isFree = (model: any) => model.cost?.input === 0

  const connected = useConnected()
  const providers = createDialogProviderOptions()

  const showExtra = createMemo(() => {
    if (!connected()) return false
    if (props.providerID) return false
    return true
  })

  const options = createMemo(() => {
    const q = query()
    const needle = q.trim()
    const showSections = showExtra() && needle.length === 0
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()

    const recentList = showSections
      ? recents.filter(
        (item) => !favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID),
      )
      : []

    const favoriteOptions = showSections
      ? favorites.flatMap((item) => {
        const provider = sync.data.provider.find((x) => x.id === item.providerID)
        if (!provider) return []
        const model = provider.models[item.modelID]
        if (!model) return []
        return [
          {
            key: item,
            value: {
              providerID: provider.id,
              modelID: model.id,
            },
            title: model.name ?? item.modelID,
            description: provider.name,
            category: "Favorites",
            disabled: false,
            footer: isFree(model) ? "Free" : undefined,
            onSelect: () => {
              dialog.clear()
              local.model.set(
                {
                  providerID: provider.id,
                  modelID: model.id,
                },
                { recent: true },
              )
            },
          },
        ]
      })
      : []

    const recentOptions = showSections
      ? recentList.flatMap((item) => {
        const provider = sync.data.provider.find((x) => x.id === item.providerID)
        if (!provider) return []
        const model = provider.models[item.modelID]
        if (!model) return []
        return [
          {
            key: item,
            value: {
              providerID: provider.id,
              modelID: model.id,
            },
            title: model.name ?? item.modelID,
            description: provider.name,
            category: "Recent",
            disabled: false,
            footer: isFree(model) ? "Free" : undefined,
            onSelect: () => {
              dialog.clear()
              local.model.set(
                {
                  providerID: provider.id,
                  modelID: model.id,
                },
                { recent: true },
              )
            },
          },
        ]
      })
      : []

    const providerOptions = pipe(
      sync.data.provider,
      sortBy(
        (provider) => provider.id !== "atomcli",
        (provider) => provider.name,
      ),
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          filter(([_, info]) => info.status !== "deprecated"),
          filter(([_, info]) => (props.providerID ? info.providerID === props.providerID : true)),
          map(([model, info]) => {
            const value = {
              providerID: provider.id,
              modelID: model,
            }
            return {
              value,
              title: info.name ?? model,
              description: favorites.some(
                (item) => item.providerID === value.providerID && item.modelID === value.modelID,
              )
                ? "(Favorite)"
                : undefined,
              category: connected() ? provider.name : undefined,
              disabled: false,
              footer: isFree(info) ? "Free" : undefined,
              onSelect() {
                dialog.clear()
                local.model.set(
                  {
                    providerID: provider.id,
                    modelID: model,
                  },
                  { recent: true },
                )
              },
            }
          }),
          filter((x) => {
            if (!showSections) return true
            const value = x.value
            const inFavorites = favorites.some(
              (item) => item.providerID === value.providerID && item.modelID === value.modelID,
            )
            if (inFavorites) return false
            const inRecents = recentList.some(
              (item) => item.providerID === value.providerID && item.modelID === value.modelID,
            )
            if (inRecents) return false
            return true
          }),
          sortBy(
            (x) => x.footer !== "Free",
            (x) => x.title,
          ),
        ),
      ),
    )

    const popularProviders = !connected()
      ? pipe(
        providers(),
        map((option) => {
          return {
            ...option,
            category: "Popular providers",
          }
        }),
        take(6),
      )
      : []

    // Search shows a single merged list (favorites inline)
    if (needle) {
      const filteredProviders = fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj)
      const filteredPopular = fuzzysort.go(needle, popularProviders, { keys: ["title"] }).map((x) => x.obj)
      return [...filteredProviders, ...filteredPopular]
    }

    // Apply free-only filter if active
    const allOptions = [...favoriteOptions, ...recentOptions, ...providerOptions, ...popularProviders]
    if (showFreeOnly()) {
      return allOptions.filter((x) => "footer" in x && x.footer === "Free")
    }

    return allOptions
  })

  const provider = createMemo(() =>
    props.providerID ? sync.data.provider.find((x) => x.id === props.providerID) : null,
  )

  const title = createMemo(() => {
    if (provider()) return provider()!.name
    return "Select model"
  })

  return (
    <DialogSelect
      keybind={[
        {
          keybind: Keybind.parse("ctrl+a")[0],
          title: connected() ? "Connect provider" : "View all providers",
          onTrigger() {
            dialog.replace(() => <DialogProvider />)
          },
        },
        {
          keybind: Keybind.parse("ctrl+f")[0],
          title: "Favorite",
          disabled: !connected(),
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as { providerID: string; modelID: string })
          },
        },
        {
          keybind: Keybind.parse("ctrl+e")[0],
          title: showFreeOnly() ? "Show all models" : "Show free only",
          onTrigger: () => {
            setShowFreeOnly((prev) => !prev)
          },
        },
      ]}
      ref={setRef}
      onFilter={setQuery}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
      options={options()}
    />
  )
}
