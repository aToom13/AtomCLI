import { createMemo, createSignal, For } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useKeyboard } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"

type TaskCategory = "coding" | "documentation" | "analysis" | "general"
type AutoMode = "speed" | "balanced" | "quality" | "reasoning"

function ratingLabel(v: number): string {
  if (v >= 2) return "++"
  if (v >= 1) return "+"
  if (v <= -2) return "--"
  if (v <= -1) return "-"
  return "·"
}

export function DialogAutoConf() {
  const sync = useSync()
  const { theme } = useTheme()
  const sdk = useSDK()
  const toast = useToast()
  const dialog = useDialog()

  const CATEGORIES: TaskCategory[] = ["coding", "documentation", "analysis", "general"]
  const MODES: AutoMode[] = ["speed", "balanced", "quality", "reasoning"]

  // Get atomcli free models
  const atomcliModels = createMemo(() => {
    const provider = sync.data.provider.find((p) => p.id === "atomcli")
    if (!provider) return []
    return Object.entries(provider.models)
      .filter(([id]) => id !== "atomcli-auto" && id !== "atomcli-free")
      .map(([id, m]) => ({
        id,
        name: (m as any).name ?? id,
        capabilities: (m as any).capabilities ?? {},
      }))
  })

  // Init state from config
  const routerCfg = (sync.data.config as any)?.experimental?.auto_router ?? {}
  const [excluded, setExcluded] = createSignal<Set<string>>(new Set<string>(routerCfg.excluded_models ?? []))
  const [ratings, setRatings] = createSignal<Map<string, Record<string, number>>>(
    new Map(Object.entries(routerCfg.model_ratings ?? {}).map(([id, r]) => [id, r as Record<string, number>])),
  )
  const [overrides, setOverrides] = createSignal<Record<string, string>>({ ...(routerCfg.category_overrides ?? {}) })
  const [mode, setMode] = createSignal<AutoMode>((sync.data.config as any)?.experimental?.auto_mode ?? "balanced")
  const [expandedModel, setExpandedModel] = createSignal<string | null>(null)
  const [saving, setSaving] = createSignal(false)

  function toggleExclude(id: string) {
    const next = new Set(excluded())
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExcluded(next)
  }

  function adjustRating(modelId: string, category: string, delta: number) {
    const next = new Map(ratings())
    const cur = next.get(modelId) ?? { coding: 0, documentation: 0, analysis: 0, general: 0 }
    const updated = { ...cur, [category]: Math.max(-2, Math.min(2, (cur[category as keyof typeof cur] ?? 0) + delta)) }
    next.set(modelId, updated)
    setRatings(next)
  }

  function toggleOverride(category: string) {
    const models = atomcliModels()
    const current = overrides()[category] ?? ""
    const next = { ...overrides() }
    if (!current) {
      // Set override to first non-excluded model
      const first = models.find((m) => !excluded().has(m.id))
      if (first) next[category] = first.id
    } else {
      // Cycle to next model or remove
      const idx = models.findIndex((m) => m.id === current)
      const nextModel = models.find((m, i) => i > idx && !excluded().has(m.id))
      if (nextModel) next[category] = nextModel.id
      else delete next[category]
    }
    setOverrides(next)
  }

  async function save() {
    setSaving(true)
    try {
      const excludedArr = [...excluded()]
      const ratingsObj: Record<string, Record<string, number>> = {}
      for (const [id, cats] of ratings()) ratingsObj[id] = cats
      const cleanOverrides: Record<string, string> = {}
      for (const [cat, mid] of Object.entries(overrides())) if (mid) cleanOverrides[cat] = mid

      const newRouter: Record<string, any> = {}
      if (excludedArr.length) newRouter.excluded_models = excludedArr
      if (Object.keys(ratingsObj).length) newRouter.model_ratings = ratingsObj
      if (Object.keys(cleanOverrides).length) newRouter.category_overrides = cleanOverrides

      const newExperimental: Record<string, any> = { auto_mode: mode() }
      if (Object.keys(newRouter).length) newExperimental.auto_router = newRouter

      await sdk.client.config.update({ body: { experimental: newExperimental } } as any)

      // Log the changes
      const currentExp = (sync.data.config as any)?.experimental || {}
      sync.set("config", "experimental" as any, { ...currentExp, ...newExperimental })

      toast.show({ title: "Auto Router", message: "Configuration saved", variant: "success" })
      dialog.clear()
    } catch {
      toast.show({ title: "Auto Router", message: "Failed to save", variant: "error" })
    } finally {
      setSaving(false)
    }
  }

  async function resetAll() {
    setExcluded(new Set<string>())
    setRatings(new Map<string, Record<string, number>>())
    setOverrides({})
    setMode("balanced")

    try {
      await sdk.client.config.update({
        body: {
          experimental: {
            auto_mode: "balanced",
            auto_router: undefined,
          },
        },
      } as any)
      const currentExp = (sync.data.config as any)?.experimental || {}
      sync.set("config", "experimental" as any, { ...currentExp, auto_mode: "balanced", auto_router: undefined })
      toast.show({ title: "Auto Router", message: "Reset to defaults", variant: "success" })
    } catch {
      // ignore
    }
    dialog.clear()
  }

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      dialog.clear()
      return
    }
    if (evt.name === "return") {
      save()
      return
    }
  })

  const models = atomcliModels()

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      {/* Header */}
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          ⚙ Auto Model Configuration
        </text>
        <text fg={theme.textMuted}>esc to close</text>
      </box>

      {/* Description */}
      <text fg={theme.textMuted}>Configure how atomcli-auto selects models. Click items to interact.</text>

      {/* Mode Selection */}
      <text attributes={TextAttributes.BOLD} fg={theme.text}>
        Mode
      </text>
      <box flexDirection="row" gap={1}>
        <For each={MODES}>
          {(m) => (
            <box onMouseUp={() => setMode(m)}>
              <text
                attributes={mode() === m ? TextAttributes.BOLD : TextAttributes.NONE}
                fg={mode() === m ? theme.accent : theme.textMuted}
              >
                [{m}]
              </text>
            </box>
          )}
        </For>
      </box>

      {/* Separator */}
      <text fg={theme.textMuted}>──────────────────────────────────────</text>

      {/* Model List */}
      <text attributes={TextAttributes.BOLD} fg={theme.text}>
        Models
      </text>
      <text fg={theme.textMuted}>Click [✓] to exclude, click model name to rate</text>

      <box flexDirection="column" height={Math.min(models.length * 2 + 1, 16)} overflow="scroll">
        <For each={models}>
          {(m) => {
            const isExcluded = () => excluded().has(m.id)
            const isExpanded = () => expandedModel() === m.id
            return (
              <>
                <box flexDirection="row" paddingTop={0} gap={1}>
                  <box onMouseUp={() => toggleExclude(m.id)}>
                    <text attributes={TextAttributes.BOLD} fg={isExcluded() ? theme.error : theme.success}>
                      [{isExcluded() ? "✗" : "✓"}]
                    </text>
                  </box>
                  <box onMouseUp={() => setExpandedModel(isExpanded() ? null : m.id)}>
                    <text
                      fg={isExcluded() ? theme.textMuted : theme.text}
                      attributes={isExpanded() ? TextAttributes.BOLD : TextAttributes.NONE}
                    >
                      {m.name}
                      {m.capabilities.reasoning ? " 🧠" : ""}
                      {m.capabilities.toolcall ? " 🔧" : ""}
                    </text>
                  </box>
                  {/* Show rating summary inline */}
                  <text fg={theme.textMuted}>
                    {(() => {
                      const r = ratings().get(m.id)
                      if (!r) return ""
                      return CATEGORIES.map((c) => {
                        const v = r[c] ?? 0
                        return v !== 0 ? `${c.slice(0, 3)}:${ratingLabel(v)}` : ""
                      })
                        .filter(Boolean)
                        .join(" ")
                    })()}
                  </text>
                </box>
                {/* Expanded ratings */}
                {isExpanded() && !isExcluded() && (
                  <box paddingLeft={3} flexDirection="column">
                    <For each={CATEGORIES}>
                      {(cat) => {
                        const val = () => ratings().get(m.id)?.[cat] ?? 0
                        return (
                          <box flexDirection="row" gap={1}>
                            <text fg={theme.textMuted} width={16}>
                              {cat}:
                            </text>
                            <box onMouseUp={() => adjustRating(m.id, cat, -1)}>
                              <text fg={theme.textMuted}>[-]</text>
                            </box>
                            <text
                              attributes={TextAttributes.BOLD}
                              fg={val() > 0 ? theme.success : val() < 0 ? theme.error : theme.text}
                            >
                              {ratingLabel(val())}
                            </text>
                            <box onMouseUp={() => adjustRating(m.id, cat, 1)}>
                              <text fg={theme.textMuted}>[+]</text>
                            </box>
                          </box>
                        )
                      }}
                    </For>
                  </box>
                )}
              </>
            )
          }}
        </For>
      </box>

      {/* Separator */}
      <text fg={theme.textMuted}>──────────────────────────────────────</text>

      {/* Category Overrides */}
      <text attributes={TextAttributes.BOLD} fg={theme.text}>
        Category Overrides
      </text>
      <text fg={theme.textMuted}>Click to cycle: (auto) → model → (auto)</text>
      <For each={CATEGORIES}>
        {(cat) => {
          const cur = () => overrides()[cat] ?? ""
          return (
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted} width={16}>
                {cat}:
              </text>
              <box onMouseUp={() => toggleOverride(cat)}>
                <text fg={cur() ? theme.accent : theme.textMuted}>{cur() || "(auto)"}</text>
              </box>
            </box>
          )
        }}
      </For>

      {/* Actions */}
      <box flexDirection="row" gap={2} paddingTop={1}>
        <box onMouseUp={() => save()}>
          <text attributes={TextAttributes.BOLD} fg={saving() ? theme.textMuted : theme.accent}>
            [ Save ]
          </text>
        </box>
        <box onMouseUp={() => resetAll()}>
          <text fg={theme.textMuted}>[ Reset ]</text>
        </box>
        <box onMouseUp={() => dialog.clear()}>
          <text fg={theme.textMuted}>[ Cancel ]</text>
        </box>
      </box>
    </box>
  )
}
