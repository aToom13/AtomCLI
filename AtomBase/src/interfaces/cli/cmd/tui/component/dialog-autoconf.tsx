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
  const sync = useSync()
  const local = useLocal()
  const sdk = useSDK()
  const toast = useToast()
  const dialog = useDialog()

  const cfg = () => (sync.data.config as any)?.experimental ?? {}
  const router = () => cfg().auto_router ?? {}

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
  const [mode, setMode] = createSignal<AutoMode>(cfg().auto_mode ?? "quality")
  const [routing, setRouting] = createSignal<boolean>(cfg().smart_model_routing ?? false)
  const [adaptive, setAdaptive] = createSignal(sync.data.config.adaptive_routing?.mode ?? "ask")
  const [thinking, setThinking] = createSignal(sync.data.config.adaptive_routing?.thinking?.mode ?? "ask")
  const [paid, setPaid] = createSignal(router().allow_paid_models === true)
  const [paidProbes, setPaidProbes] = createSignal(router().allow_paid_probes === true)
  const [saving, setSaving] = createSignal(false)
  // Which model is expanded to show per-category ratings (Shift+E toggle)
  const [expanded, setExpanded] = createSignal<string | null>(null)

  onMount(() => dialog.setSize("large"))

  const models = createMemo(() => {
    const provider = sync.data.provider.find((p) => p.id === "atomcli")
    if (!provider) return []
    return Object.entries(provider.models)
      .filter(([id]) => id !== "atomcli-auto" && id !== "atomcli-free")
      .map(([id, m]) => ({ id, name: (m as any).name ?? id }))
  })

  function cycleMode(dir: -1 | 1) {
    const idx = MODES.indexOf(mode())
    setMode(MODES[(idx + dir + MODES.length) % MODES.length])
  }

  function toggleExclude(id: string) {
    const next = new Set(excluded())
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExcluded(next)
  }

  function getRatings(modelId: string): CategoryRatings {
    return ratings()[modelId] ?? { coding: 0, documentation: 0, analysis: 0, general: 0 }
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
        .filter((m) => !excluded().has(m.id))
        .map((m) => m.id),
    ]
    const idx = list.indexOf(cur)
    const next = list[(idx + dir + list.length) % list.length]
    const o = { ...overrides() }
    if (next) o[category] = next
    else delete o[category]
    setOverrides(o)
  }

  async function save() {
    setSaving(true)
    try {
      const ratingsObj: Record<string, Record<string, number>> = {}
      for (const [id, cats] of Object.entries(ratings())) {
        const hasNonZero = Object.values(cats).some((v) => v !== 0)
        if (hasNonZero) ratingsObj[id] = cats
      }
      const cleanOverrides: Record<string, string> = {}
      for (const [cat, mid] of Object.entries(overrides())) {
        if (mid) cleanOverrides[cat] = mid
      }

      const payload = {
        adaptive_routing: {
          ...sync.data.config.adaptive_routing,
          mode: adaptive(),
          thinking: { ...sync.data.config.adaptive_routing?.thinking, mode: thinking() },
        },
        experimental: {
          smart_model_routing: routing(),
          auto_mode: mode(),
          auto_router: {
            ...router(),
            allow_paid_models: paid(),
            allow_paid_probes: paidProbes(),
            excluded_models: [...excluded()],
            model_ratings: ratingsObj,
            category_overrides: cleanOverrides,
          },
        },
      }

      await sdk.client.config.update(payload, { throwOnError: true })

      const currentExp = (sync.data.config as any)?.experimental || {}
      sync.set("config", "experimental" as any, { ...currentExp, ...payload.experimental })
      sync.set("config", "adaptive_routing", payload.adaptive_routing)
      toast.show({ title: "Auto Router", message: "Saved", variant: "success" })
      dialog.clear()
    } catch (e) {
      toast.show({ title: "Auto Router", message: `Failed: ${(e as Error).message}`, variant: "error" })
    } finally {
      setSaving(false)
    }
  }

  async function resetAll() {
    const payload = {
      experimental: {
        smart_model_routing: false,
        auto_mode: "quality" as const,
        auto_router: { ...router(), excluded_models: [], model_ratings: {}, category_overrides: {} },
      },
    }
    try {
      await sdk.client.config.update(payload, { throwOnError: true })
      const currentExp = (sync.data.config as any)?.experimental || {}
      sync.set("config", "experimental" as any, { ...currentExp, ...payload.experimental })
      toast.show({ title: "Auto Router", message: "Reset", variant: "success" })
    } catch (error) {
      toast.show({ title: "Auto Router", message: `Reset failed: ${(error as Error).message}`, variant: "error" })
      return
    }
    setExcluded(new Set<string>())
    setRatings({})
    setOverrides({})
    setMode("quality")
    setRouting(false)
    setExpanded(null)
    dialog.clear()
  }

  // --- Build options ---
  const options = createMemo(() => {
    const list: any[] = []

    for (const modelID of ["atomcli-auto", "atomcli-free"]) {
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

    // Settings
    for (const [value, label, current, set] of [
      ["adaptive", "Adaptive model proposals", adaptive, setAdaptive],
      ["thinking", "Thinking proposals", thinking, setThinking],
    ] as const) {
      list.push({
        title: `${label}  ◀ ${current()} ▶`,
        value,
        category: "Adaptive routing (auto requires a grant)",
        onSelect: () => set(APPROVAL_MODES[(APPROVAL_MODES.indexOf(current()) + 1) % APPROVAL_MODES.length]),
      })
    }
    list.push(
      {
        title: `Auto: allow paid models  ${paid() ? "[ON]" : "[OFF]"}`,
        value: "paid",
        category: "Auto / Free (Free always uses verified zero-cost models)",
        onSelect: () => setPaid(!paid()),
      },
      {
        title: `Auto: allow paid verification requests  ${paidProbes() ? "[ON]" : "[OFF]"}`,
        value: "paid-probes",
        category: "Auto / Free (Free always uses verified zero-cost models)",
        onSelect: () => setPaidProbes(!paidProbes()),
      },
    )
    list.push({
      title: `Smart Routing  ${routing() ? "[ON]" : "[OFF]"}`,
      value: "routing",
      category: "Settings",
      onSelect: () => setRouting(!routing()),
    })
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
    for (const m of models()) {
      const ex = excluded().has(m.id)
      const r = getRatings(m.id)
      const avg = avgRating(r)
      const isExpanded = expanded() === m.id

      list.push({
        title: `${ex ? "[ ]" : "[✓]"} ${m.name}  ${stars(avg)}  ${isExpanded ? "▼" : "▶ Shift+E"}`,
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
      title="Auto / Free Model Settings"
      options={options()}
      skipFilter={true}
      keybind={[
        {
          keybind: Keybind.parse("left")[0],
          title: "◀",
          onTrigger: (opt) => {
            const v = opt.value as string
            if (v === "adaptive" || v === "thinking") {
              const current = v === "adaptive" ? adaptive : thinking
              const set = v === "adaptive" ? setAdaptive : setThinking
              set(
                APPROVAL_MODES[(APPROVAL_MODES.indexOf(current()) + APPROVAL_MODES.length - 1) % APPROVAL_MODES.length],
              )
            } else if (v === "paid" || v === "paid-probes") opt.onSelect?.(dialog)
            if (v === "routing") setRouting(!routing())
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
            if (["adaptive", "thinking", "paid", "paid-probes"].includes(v)) opt.onSelect?.(dialog)
            if (v === "routing") setRouting(!routing())
            else if (v === "mode") cycleMode(1)
            else if (v.startsWith("ov-")) cycleOverride(v.slice(3) as TaskCategory, 1)
            else if (v.startsWith("r-")) {
              const p = parseRatingValue(v)
              if (p) adjustCategoryRating(p.modelId, p.cat, 1)
            } else if (v.startsWith("m-")) adjustAllRatings(v.slice(2), 1)
          },
        },
        {
          keybind: Keybind.parse("space")[0],
          title: "toggle",
          onTrigger: (opt) => {
            const v = opt.value as string
            if (["adaptive", "thinking", "paid", "paid-probes"].includes(v)) opt.onSelect?.(dialog)
            if (v === "routing") setRouting(!routing())
            else if (v === "mode") cycleMode(1)
            else if (v.startsWith("ov-")) cycleOverride(v.slice(3) as TaskCategory, 1)
            else if (v.startsWith("m-")) toggleExclude(v.slice(2))
            else if (v.startsWith("r-")) {
              const p = parseRatingValue(v)
              if (p) adjustCategoryRating(p.modelId, p.cat, 1)
            } else if (v === "save" && !saving()) save()
            else if (v === "reset") resetAll()
            else if (v === "cancel") dialog.clear()
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
