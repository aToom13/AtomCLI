import { createMemo, createSignal, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useLocal } from "@tui/context/local"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import { Keybind } from "@/util/util/keybind"

type TaskCategory = "coding" | "documentation" | "analysis" | "general"
type AutoMode = "speed" | "balanced" | "quality" | "reasoning"
type CategoryRatings = Record<TaskCategory, number>

const CATEGORIES: TaskCategory[] = ["coding", "documentation", "analysis", "general"]
const MODES: AutoMode[] = ["speed", "balanced", "quality", "reasoning"]
const APPROVAL_MODES = ["off", "ask", "auto"] as const
const RATING_MIN = -3
const RATING_MAX = 3

function stars(v: number): string {
  if (v >= 3) return "★★★"
  if (v >= 2) return "★★·"
  if (v >= 1) return "★··"
  if (v <= -3) return "✗✗✗"
  if (v <= -2) return "✗✗·"
  if (v <= -1) return "✗··"
  return "···"
}

function avgRating(r: CategoryRatings): number {
  return Math.round((r.coding + r.documentation + r.analysis + r.general) / 4)
}

export function DialogAutoConf() {
  const dialog = useDialog()
  return (
    <DialogSelect
      title="Routing settings"
      options={[
        {
          title: "AtomCLI Auto",
          value: "auto",
          description: "Choose providers, models and ranking preferences",
          onSelect: () => dialog.replace(() => <DialogRouterProfile profile="auto" />),
        },
        {
          title: "AtomCLI Free",
          value: "free",
          description: "Independent preferences; atomcli zero-cost models only",
          onSelect: () => dialog.replace(() => <DialogRouterProfile profile="free" />),
        },
        {
          title: "Adaptive routing",
          value: "adaptive",
          description: "Shared controls for model/thinking proposals during work",
          onSelect: () => dialog.replace(() => <DialogAdaptiveRouting />),
        },
      ]}
    />
  )
}

function DialogAdaptiveRouting() {
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const [adaptive, setAdaptive] = createSignal(sync.data.config.adaptive_routing?.mode ?? "ask")
  const [thinking, setThinking] = createSignal(sync.data.config.adaptive_routing?.thinking?.mode ?? "ask")
  const [routing, setRouting] = createSignal(sync.data.config.experimental?.smart_model_routing ?? false)
  const [saving, setSaving] = createSignal(false)
  async function save() {
    if (saving()) return
    setSaving(true)
    const payload = {
      adaptive_routing: {
        ...sync.data.config.adaptive_routing,
        mode: adaptive(),
        thinking: { ...sync.data.config.adaptive_routing?.thinking, mode: thinking() },
      },
      experimental: { smart_model_routing: routing() },
    }
    try {
      await sdk.client.config.update(payload, { throwOnError: true })
      sync.set("config", "adaptive_routing", payload.adaptive_routing)
      sync.set("config", "experimental", { ...sync.data.config.experimental, ...payload.experimental })
      toast.show({ title: "Adaptive routing", message: "Saved", variant: "success" })
      dialog.clear()
    } catch (error) {
      toast.show({ title: "Adaptive routing", message: String(error), variant: "error" })
    } finally {
      setSaving(false)
    }
  }
  return (
    <DialogSelect
      title="Adaptive routing"
      description={
        <text>
          Routing selects the starting model. Adaptive routing proposes changes during work; auto requires a grant.
        </text>
      }
      options={[
        {
          title: `Model proposals: ${adaptive()}`,
          value: "model",
          onSelect: () => setAdaptive(APPROVAL_MODES[(APPROVAL_MODES.indexOf(adaptive()) + 1) % APPROVAL_MODES.length]),
        },
        {
          title: `Thinking proposals: ${thinking()}`,
          value: "thinking",
          onSelect: () => setThinking(APPROVAL_MODES[(APPROVAL_MODES.indexOf(thinking()) + 1) % APPROVAL_MODES.length]),
        },
        {
          title: `Task-category routing: ${routing() ? "ON" : "OFF"}`,
          value: "routing",
          description: "Category-based selection for orchestration; Auto/Free aliases always resolve",
          onSelect: () => setRouting(!routing()),
        },
        { title: saving() ? "Saving..." : "Save", value: "save", onSelect: save },
      ]}
    />
  )
}

export function DialogRouterProfile(props: { profile: "auto" | "free" }) {
  const sync = useSync()
  const local = useLocal()
  const sdk = useSDK()
  const toast = useToast()
  const dialog = useDialog()

  const cfg = () => (sync.data.config as any)?.experimental ?? {}
  const key = props.profile === "free" ? "free_router" : "auto_router"
  const title = props.profile === "free" ? "AtomCLI Free" : "AtomCLI Auto"
  const router = () => cfg()[key] ?? {}
  const [providers, setProviders] = createSignal(
    new Set<string>(router().allowed_providers ?? sync.data.provider.map((p) => p.id)),
  )
  const [included, setIncluded] = createSignal<Set<string> | undefined>(
    router().allowed_models ? new Set(router().allowed_models) : undefined,
  )

  const [excluded, setExcluded] = createSignal<Set<string>>(new Set(router().excluded_models ?? []))
  const [ratings, setRatings] = createSignal<Record<string, CategoryRatings>>(
    (() => {
      const mr = router().model_ratings ?? {}
      const out: Record<string, CategoryRatings> = {}
      for (const [id, cats] of Object.entries(mr)) {
        const c = cats as Record<string, number>
        out[id] = {
          coding: c.coding ?? 0,
          documentation: c.documentation ?? 0,
          analysis: c.analysis ?? 0,
          general: c.general ?? 0,
        }
      }
      return out
    })(),
  )
  const [overrides, setOverrides] = createSignal<Record<string, string>>({ ...(router().category_overrides ?? {}) })
  const [mode, setMode] = createSignal<AutoMode>(
    router().mode ?? (props.profile === "auto" ? cfg().auto_mode : undefined) ?? "quality",
  )
  const [paid, setPaid] = createSignal(router().allow_paid_models === true)
  const [paidProbes, setPaidProbes] = createSignal(router().allow_paid_probes === true)
  const [saving, setSaving] = createSignal(false)
  // Which model is expanded to show per-category ratings (Shift+E toggle)
  const [expanded, setExpanded] = createSignal<string | null>(null)

  onMount(() => dialog.setSize("large"))

  const models = createMemo(() => {
    return sync.data.provider
      .filter((p) => props.profile === "auto" || p.id === "atomcli")
      .flatMap((p) =>
        Object.entries(p.models)
          .filter(([id]) => id !== "atomcli-auto" && id !== "atomcli-free")
          .map(([id, m]) => ({ id: `${p.id}/${id}`, bare: id, providerID: p.id, name: m.name ?? id })),
      )
  })

  function isExcluded(id: string) {
    return (
      excluded().has(id) ||
      excluded().has(id.slice(id.indexOf("/") + 1)) ||
      (included() !== undefined && !included()!.has(id))
    )
  }

  function cycleMode(dir: -1 | 1) {
    const idx = MODES.indexOf(mode())
    setMode(MODES[(idx + dir + MODES.length) % MODES.length])
  }

  function toggleExclude(id: string) {
    const next = new Set(excluded())
    const wasExcluded = isExcluded(id)
    const bare = id.slice(id.indexOf("/") + 1)
    if (next.delete(bare)) {
      for (const model of models()) if (model.bare === bare && model.id !== id) next.add(model.id)
    }
    if (wasExcluded) next.delete(id)
    else next.add(id)
    setExcluded(next)
    if (included()) {
      const allowed = new Set(included())
      if (wasExcluded) allowed.add(id)
      else allowed.delete(id)
      setIncluded(allowed)
    }
  }

  function getRatings(modelId: string): CategoryRatings {
    return (
      ratings()[modelId] ??
      ratings()[modelId.slice(modelId.indexOf("/") + 1)] ?? { coding: 0, documentation: 0, analysis: 0, general: 0 }
    )
  }

  function adjustCategoryRating(modelId: string, cat: TaskCategory, delta: number) {
    const all = { ...ratings() }
    const cur = { ...getRatings(modelId) }
    cur[cat] = Math.max(RATING_MIN, Math.min(RATING_MAX, cur[cat] + delta))
    all[modelId] = cur
    setRatings(all)
  }

  function adjustAllRatings(modelId: string, delta: number) {
    const all = { ...ratings() }
    const cur = { ...getRatings(modelId) }
    for (const cat of CATEGORIES) {
      cur[cat] = Math.max(RATING_MIN, Math.min(RATING_MAX, cur[cat] + delta))
    }
    all[modelId] = cur
    setRatings(all)
  }

  function toggleExpand(modelId: string) {
    setExpanded(expanded() === modelId ? null : modelId)
  }

  function cycleOverride(category: TaskCategory, dir: -1 | 1) {
    const cur = overrides()[category] ?? ""
    const list = [
      "",
      ...models()
        .filter((m) => !isExcluded(m.id) && (props.profile === "free" || providers().has(m.providerID)))
        .map((m) => m.id),
    ]
    const idx = list.indexOf(cur)
    const next = list[(idx + dir + list.length) % list.length]
    const o = { ...overrides() }
    if (next) o[category] = next
    else o[category] = ""
    setOverrides(o)
  }

  async function save() {
    setSaving(true)
    try {
      const ratingsObj: Record<string, Record<string, number>> = {}
      for (const [id, cats] of Object.entries(ratings())) {
        ratingsObj[id] = cats
      }
      const cleanOverrides: Record<string, string> = {}
      for (const [cat, mid] of Object.entries(overrides())) {
        cleanOverrides[cat] = mid
      }

      const payload = {
        experimental: {
          [key]: {
            ...router(),
            mode: mode(),
            ...(props.profile === "auto"
              ? { allow_paid_models: paid(), allow_paid_probes: paidProbes(), allowed_providers: [...providers()] }
              : {}),
            ...(included() ? { allowed_models: [...included()!] } : {}),
            excluded_models: [...excluded()],
            model_ratings: ratingsObj,
            category_overrides: cleanOverrides,
          },
        },
      }

      await sdk.client.config.update(payload, { throwOnError: true })

      const currentExp = (sync.data.config as any)?.experimental || {}
      sync.set("config", "experimental" as any, { ...currentExp, ...payload.experimental })
      toast.show({ title, message: "Saved", variant: "success" })
      dialog.clear()
    } catch (e) {
      toast.show({ title, message: `Failed: ${(e as Error).message}`, variant: "error" })
    } finally {
      setSaving(false)
    }
  }

  async function resetAll() {
    if (saving()) return
    setExcluded(new Set<string>())
    setIncluded(new Set(models().map((m) => m.id)))
    setProviders(new Set(sync.data.provider.map((p) => p.id)))
    setRatings(
      Object.fromEntries(
        Object.keys(ratings()).map((id) => [id, { coding: 0, documentation: 0, analysis: 0, general: 0 }]),
      ),
    )
    setOverrides(Object.fromEntries(CATEGORIES.map((cat) => [cat, ""])))
    setMode("quality")
    setPaid(false)
    setPaidProbes(false)
    await save()
  }

  // --- Build options ---
  const options = createMemo(() => {
    const list: any[] = []

    for (const modelID of [props.profile === "free" ? "atomcli-free" : "atomcli-auto"]) {
      if (!sync.data.provider.find((provider) => provider.id === "atomcli")?.models[modelID]) continue
      list.push({
        title: modelID === "atomcli-auto" ? "Use AtomCLI Auto" : "Use AtomCLI Free",
        value: `select-${modelID}`,
        category: "Select model (save settings first)",
        onSelect: () => {
          local.model.set({ providerID: "atomcli", modelID }, { recent: true, manual: true })
          dialog.clear()
        },
      })
    }

    if (props.profile === "auto") {
      for (const p of sync.data.provider)
        list.push({
          title: `${providers().has(p.id) ? "[✓]" : "[ ]"} ${p.name} (${p.id})`,
          value: `provider-${p.id}`,
          category: "Included providers",
          onSelect: () => {
            const next = new Set(providers())
            if (next.has(p.id)) next.delete(p.id)
            else next.add(p.id)
            setProviders(next)
          },
        })
      list.push(
        {
          title: `Auto: allow paid models  ${paid() ? "[ON]" : "[OFF]"}`,
          value: "paid",
          category: "Settings",
          onSelect: () => setPaid(!paid()),
        },
        {
          title: `Auto: allow paid verification requests  ${paidProbes() ? "[ON]" : "[OFF]"}`,
          value: "paid-probes",
          category: "Settings",
          onSelect: () => setPaidProbes(!paidProbes()),
        },
      )
    }
    list.push({
      title: `Mode           ◀ ${mode()} ▶`,
      value: "mode",
      category: "Settings",
      onSelect: () => cycleMode(1),
    })

    // Overrides
    for (const cat of CATEGORIES) {
      const mid = overrides()[cat]
      const label = mid ? (models().find((m) => m.id === mid)?.name ?? mid) : "auto"
      list.push({
        title: `${cat.padEnd(14)} ◀ ${label} ▶`,
        value: `ov-${cat}`,
        category: "Overrides",
        onSelect: () => cycleOverride(cat, 1),
      })
    }

    // Models
    for (const m of models().filter((m) => props.profile === "free" || providers().has(m.providerID))) {
      const ex = isExcluded(m.id)
      const r = getRatings(m.id)
      const avg = avgRating(r)
      const isExpanded = expanded() === m.id

      list.push({
        title: `${ex ? "[ ]" : "[✓]"} ${m.name} (${m.id})  ${stars(avg)}  ${isExpanded ? "▼" : "▶ Shift+E"}`,
        value: `m-${m.id}`,
        category: "Models",
        onSelect: () => toggleExclude(m.id),
      })

      // Per-category sub-rows when expanded
      if (isExpanded && !ex) {
        for (const cat of CATEGORIES) {
          const val = r[cat]
          list.push({
            title: `    ${cat.padEnd(14)} ◀ ${stars(val)} (${val >= 0 ? "+" : ""}${val}) ▶`,
            value: `r-${m.id}-${cat}`,
            category: "Models",
            onSelect: () => adjustCategoryRating(m.id, cat, 1),
          })
        }
      }
    }

    // Actions
    list.push({
      title: saving() ? "  Saving..." : "  Save",
      value: "save",
      category: "─",
      onSelect: () => {
        if (!saving()) save()
      },
    })
    list.push({ title: "  Reset model preferences", value: "reset", category: "─", onSelect: () => resetAll() })
    list.push({ title: "  Cancel", value: "cancel", category: "─", onSelect: () => dialog.clear() })

    return list
  })

  // Parse "r-{modelId}-{category}" where modelId may contain dashes
  function parseRatingValue(v: string): { modelId: string; cat: TaskCategory } | null {
    const rest = v.slice(2) // remove "r-"
    for (const cat of CATEGORIES) {
      if (rest.endsWith(`-${cat}`)) {
        return { modelId: rest.slice(0, -(cat.length + 1)), cat }
      }
    }
    return null
  }

  return (
    <DialogSelect
      title={`${title} settings`}
      description={
        <text>
          {props.profile === "free"
            ? "Only atomcli zero-cost models, including fallback and helper calls."
            : "Select included providers and models. Enter toggles; arrows adjust ratings."}
        </text>
      }
      options={options()}
      keybind={[
        {
          keybind: Keybind.parse("left")[0],
          title: "◀",
          onTrigger: (opt) => {
            const v = opt.value as string
            if (v === "paid" || v === "paid-probes") opt.onSelect?.(dialog)
            else if (v === "mode") cycleMode(-1)
            else if (v.startsWith("ov-")) cycleOverride(v.slice(3) as TaskCategory, -1)
            else if (v.startsWith("r-")) {
              const p = parseRatingValue(v)
              if (p) adjustCategoryRating(p.modelId, p.cat, -1)
            } else if (v.startsWith("m-")) adjustAllRatings(v.slice(2), -1)
          },
        },
        {
          keybind: Keybind.parse("right")[0],
          title: "▶",
          onTrigger: (opt) => {
            const v = opt.value as string
            if (["paid", "paid-probes"].includes(v)) opt.onSelect?.(dialog)
            else if (v === "mode") cycleMode(1)
            else if (v.startsWith("ov-")) cycleOverride(v.slice(3) as TaskCategory, 1)
            else if (v.startsWith("r-")) {
              const p = parseRatingValue(v)
              if (p) adjustCategoryRating(p.modelId, p.cat, 1)
            } else if (v.startsWith("m-")) adjustAllRatings(v.slice(2), 1)
          },
        },
        {
          // Shift+E to expand/collapse per-category ratings
          keybind: Keybind.parse("shift+e")[0],
          title: "details",
          onTrigger: (opt) => {
            const v = opt.value as string
            if (v.startsWith("m-")) {
              toggleExpand(v.slice(2))
            } else if (v.startsWith("r-")) {
              // If on a sub-row, collapse the parent
              const p = parseRatingValue(v)
              if (p) toggleExpand(p.modelId)
            }
          },
        },
      ]}
    />
  )
}
