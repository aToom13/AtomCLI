import { createMemo, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useSync } from "@tui/context/sync"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useKeyboard } from "@opentui/solid"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"

type TaskCategory = "coding" | "documentation" | "analysis" | "general"
type AutoMode = "speed" | "balanced" | "quality" | "reasoning"

const CATEGORIES: TaskCategory[] = ["coding", "documentation", "analysis", "general"]
const MODES: AutoMode[] = ["speed", "balanced", "quality", "reasoning"]

function ratingLabel(v: number): string {
  if (v >= 2) return "++"
  if (v >= 1) return "+"
  if (v <= -2) return "--"
  if (v <= -1) return "-"
  return "·"
}

function cycleMode(mode: AutoMode, dir: -1 | 1): AutoMode {
  const idx = MODES.indexOf(mode)
  return MODES[(idx + dir + MODES.length) % MODES.length]
}

export function DialogAutoConf() {
  const sync = useSync()
  const { theme } = useTheme()
  const sdk = useSDK()
  const toast = useToast()
  const dialog = useDialog()

  // --- Config state ---
  const routerCfg = (sync.data.config as any)?.experimental?.auto_router ?? {}
  const [excluded, setExcluded] = createSignal<Set<string>>(new Set<string>(routerCfg.excluded_models ?? []))
  const [ratings, setRatings] = createSignal<Map<string, Record<string, number>>>(
    new Map(Object.entries(routerCfg.model_ratings ?? {}).map(([id, r]) => [id, r as Record<string, number>])),
  )
  const [overrides, setOverrides] = createSignal<Record<string, string>>({ ...(routerCfg.category_overrides ?? {}) })
  const [mode, setMode] = createSignal<AutoMode>((sync.data.config as any)?.experimental?.auto_mode ?? "balanced")
  const [saving, setSaving] = createSignal(false)

  // --- Focus state ---
  // section: 0=mode, 1=models, 2=models-ratings(sub), 3=overrides, 4=actions
  const [focus, setFocus] = createStore({
    section: 0,
    modelIdx: 0,
    ratingCatIdx: 0,
    overrideIdx: 0,
    actionIdx: 0,
  })

  let scrollRef: ScrollBoxRenderable | undefined

  const models = createMemo(() => {
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

  const modelList = models()

  // Clamp modelIdx when model list shrinks (e.g. provider data changes)
  const clampedModelIdx = () => {
    if (focus.modelIdx >= modelList.length) {
      return Math.max(0, modelList.length - 1)
    }
    return focus.modelIdx
  }

  const expandedModelId = createMemo<string | null>(() => {
    if (focus.section !== 2) return null
    const idx = clampedModelIdx()
    return modelList[idx]?.id ?? null
  })

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
    const current = overrides()[category] ?? ""
    const next = { ...overrides() }
    if (!current) {
      const first = modelList.find((m) => !excluded().has(m.id))
      if (first) next[category] = first.id
    } else {
      const idx = modelList.findIndex((m) => m.id === current)
      const nextModel = modelList.find((m, i) => i > idx && !excluded().has(m.id))
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
        body: { experimental: { auto_mode: "balanced", auto_router: undefined } },
      } as any)
      const currentExp = (sync.data.config as any)?.experimental || {}
      sync.set("config", "experimental" as any, { ...currentExp, auto_mode: "balanced", auto_router: undefined })
      toast.show({ title: "Auto Router", message: "Reset to defaults", variant: "success" })
    } catch {
      /* ignore */
    }
    dialog.clear()
  }

  // --- Keyboard Navigation ---
  useKeyboard((evt) => {
    // Always stop propagation for any key while dialog is open
    // This prevents the background textarea/prompt from processing
    // Tab, arrows, Enter, Space, etc.
    const handled = () => {
      evt.preventDefault()
      evt.stopPropagation()
    }

    // Escape: collapse ratings first; only close dialog if not in ratings
    if (evt.name === "escape") {
      if (focus.section === 2) {
        setFocus("section", 1)
        handled()
        return
      }
      // Let dialog.tsx handle close — do NOT stopPropagation
      return
    }

    // Tab: cycle sections (skip section 2 which is a models substate)
    if (evt.name === "tab") {
      const order = [0, 1, 3, 4] // mode, models, overrides, actions
      const current = focus.section === 2 ? 1 : focus.section
      const idx = order.indexOf(current)
      const next = idx === -1 ? 0 : evt.shift ? (idx - 1 + order.length) % order.length : (idx + 1) % order.length
      setFocus("section", order[next])
      handled()
      return
    }

    // Section-specific key handling
    switch (focus.section) {
      case 0: {
        // Mode
        if (evt.name === "left") {
          setMode(cycleMode(mode(), -1))
          handled()
        }
        if (evt.name === "right") {
          setMode(cycleMode(mode(), 1))
          handled()
        }
        break
      }
      case 1: {
        // Models (list)
        if (!modelList.length) break
        const idx = clampedModelIdx()
        if (evt.name === "up" && idx > 0) {
          setFocus("modelIdx", idx - 1)
          handled()
        }
        if (evt.name === "down" && idx < modelList.length - 1) {
          setFocus("modelIdx", idx + 1)
          handled()
        }
        if (evt.name === "space") {
          const m = modelList[idx]
          if (m) toggleExclude(m.id)
          handled()
        }
        if (evt.name === "enter" || (evt.name === "right" && modelList[idx])) {
          setFocus("ratingCatIdx", 0)
          setFocus("section", 2)
          handled()
        }
        break
      }
      case 2: {
        // Models — rating detail
        if (!modelList.length) break
        const idx = clampedModelIdx()
        const m = modelList[idx]
        if (!m) break
        if (evt.name === "up" && focus.ratingCatIdx > 0) {
          setFocus("ratingCatIdx", focus.ratingCatIdx - 1)
          handled()
        }
        if (evt.name === "down" && focus.ratingCatIdx < CATEGORIES.length - 1) {
          setFocus("ratingCatIdx", focus.ratingCatIdx + 1)
          handled()
        }
        if (evt.name === "left") {
          adjustRating(m.id, CATEGORIES[focus.ratingCatIdx], -1)
          handled()
        }
        if (evt.name === "right") {
          adjustRating(m.id, CATEGORIES[focus.ratingCatIdx], 1)
          handled()
        }
        if (evt.name === "enter") {
          setFocus("section", 1)
          handled()
        }
        break
      }
      case 3: {
        // Overrides
        if (evt.name === "up" && focus.overrideIdx > 0) {
          setFocus("overrideIdx", focus.overrideIdx - 1)
          handled()
        }
        if (evt.name === "down" && focus.overrideIdx < CATEGORIES.length - 1) {
          setFocus("overrideIdx", focus.overrideIdx + 1)
          handled()
        }
        if (evt.name === "space" || evt.name === "enter") {
          toggleOverride(CATEGORIES[focus.overrideIdx])
          handled()
        }
        break
      }
      case 4: {
        // Actions
        const total = 3
        if (evt.name === "left" && focus.actionIdx > 0) {
          setFocus("actionIdx", focus.actionIdx - 1)
          handled()
        }
        if (evt.name === "right" && focus.actionIdx < total - 1) {
          setFocus("actionIdx", focus.actionIdx + 1)
          handled()
        }
        if (evt.name === "enter" || evt.name === "space") {
          if (focus.actionIdx === 0 && !saving()) save()
          if (focus.actionIdx === 1) resetAll()
          if (focus.actionIdx === 2) dialog.clear()
          handled()
        }
        break
      }
    }
  })

  // --- Render helpers ---
  const activeFg = selectedForeground(theme)

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      {/* ===== Header ===== */}
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Auto Model Configuration
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      {/* ===== Mode ===== */}
      <box>
        <box flexDirection="row" justifyContent="space-between" paddingBottom={0}>
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            Mode
          </text>
          <Show when={focus.section === 0}>
            <text fg={theme.textMuted}>← →</text>
          </Show>
        </box>
        <box flexDirection="row" gap={1} paddingTop={0}>
          <For each={MODES}>
            {(m) => {
              const isModeActive = mode() === m
              const isFocused = focus.section === 0
              return (
                <box
                  backgroundColor={isModeActive && isFocused ? theme.primary : undefined}
                  onMouseUp={() => setMode(m)}
                >
                  <text
                    attributes={isModeActive ? TextAttributes.BOLD : undefined}
                    fg={isModeActive ? (isFocused ? activeFg : theme.accent) : theme.text}
                  >
                    {m}
                  </text>
                </box>
              )
            }}
          </For>
        </box>
      </box>

      {/* ===== Models ===== */}
      <box>
        <box flexDirection="row" justifyContent="space-between">
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            Models
          </text>
          <Show when={focus.section === 1}>
            <text fg={theme.textMuted}>↑↓ space enter</text>
          </Show>
          <Show when={focus.section === 2}>
            <text fg={theme.textMuted}>↑↓ ← → esc</text>
          </Show>
        </box>
        <scrollbox
          ref={(r: ScrollBoxRenderable) => (scrollRef = r)}
          height={Math.min(modelList.length * 3 + 1, 14)}
          scrollY={true}
        >
          <For each={modelList}>
            {(m, i) => {
              const idx = i()
              const isExcl = excluded().has(m.id)
              const isExpanded = expandedModelId() === m.id
              const isModelFocused = (focus.section === 1 || focus.section === 2) && focus.modelIdx === idx
              const fgColor = isExcl ? theme.textMuted : isModelFocused ? activeFg : theme.text

              return (
                <>
                  {/* ── Model row ── */}
                  <box flexDirection="row" gap={1} backgroundColor={isModelFocused ? theme.primary : undefined}>
                    {/* Toggle exclude */}
                    <box onMouseUp={() => toggleExclude(m.id)}>
                      <text attributes={TextAttributes.BOLD} fg={isExcl ? theme.error : theme.success}>
                        [{isExcl ? "✗" : "✓"}]
                      </text>
                    </box>

                    {/* Model name */}
                    <text fg={fgColor}>
                      {m.name}
                      {m.capabilities.reasoning ? " \uD83E\uDDE0" : ""}
                      {m.capabilities.toolcall ? " \uD83D\uDD27" : ""}
                    </text>

                    {/* Rating badges (always visible) */}
                    <Show
                      when={(() => {
                        const r = ratings().get(m.id)
                        return r && Object.values(r).some((v) => v !== 0)
                      })()}
                    >
                      <text fg={theme.textMuted}>
                        {(() => {
                          const r = ratings().get(m.id)
                          if (!r) return ""
                          return CATEGORIES.map((c) => `${c.slice(0, 3)}:${ratingLabel(r[c] ?? 0)}`).join(" ")
                        })()}
                      </text>
                    </Show>
                  </box>

                  {/* ── Expanded rating rows ── */}
                  {isExpanded && !isExcl && (
                    <For each={CATEGORIES}>
                      {(cat, ci) => {
                        const catIdx = ci()
                        const val = ratings().get(m.id)?.[cat] ?? 0
                        const isCatFocused = focus.section === 2 && focus.ratingCatIdx === catIdx

                        return (
                          <box
                            flexDirection="row"
                            gap={1}
                            paddingLeft={3}
                            backgroundColor={isCatFocused ? theme.primary : undefined}
                            onMouseUp={() => {
                              setFocus("section", 2)
                              setFocus("ratingCatIdx", catIdx)
                            }}
                          >
                            <text fg={isCatFocused ? activeFg : theme.textMuted} width={16}>
                              {cat}:
                            </text>
                            <Show when={isCatFocused}>
                              <text fg={activeFg}>[</text>
                            </Show>
                            <text fg={theme.textMuted}>-</text>
                            <text
                              attributes={TextAttributes.BOLD}
                              fg={val > 0 ? theme.success : val < 0 ? theme.error : theme.text}
                            >
                              {ratingLabel(val)}
                            </text>
                            <text fg={theme.textMuted}>+</text>
                            <Show when={isCatFocused}>
                              <text fg={activeFg}>]</text>
                            </Show>
                            <Show when={isCatFocused}>
                              <text fg={theme.textMuted}>← →</text>
                            </Show>
                          </box>
                        )
                      }}
                    </For>
                  )}
                </>
              )
            }}
          </For>
        </scrollbox>
      </box>

      {/* ===== Category Overrides ===== */}
      <box>
        <box flexDirection="row" justifyContent="space-between">
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            Overrides
          </text>
          <Show when={focus.section === 3}>
            <text fg={theme.textMuted}>↑↓ space</text>
          </Show>
        </box>
        <For each={CATEGORIES}>
          {(cat, ci) => {
            const catIdx = ci()
            const cur = overrides()[cat] ?? ""
            const isFocused = focus.section === 3 && focus.overrideIdx === catIdx
            return (
              <box
                flexDirection="row"
                gap={1}
                backgroundColor={isFocused ? theme.primary : undefined}
                onMouseUp={() => {
                  setFocus("section", 3)
                  setFocus("overrideIdx", catIdx)
                  toggleOverride(cat)
                }}
              >
                <text fg={isFocused ? activeFg : theme.textMuted} width={16}>
                  {cat}:
                </text>
                <text fg={cur ? theme.accent : theme.textMuted}>{cur || "(auto)"}</text>
              </box>
            )
          }}
        </For>
      </box>

      {/* ===== Actions ===== */}
      <box>
        <box flexDirection="row" justifyContent="center" gap={3} paddingTop={1}>
          {/* Save */}
          <box
            backgroundColor={focus.section === 4 && focus.actionIdx === 0 ? theme.primary : undefined}
            onMouseUp={() => save()}
          >
            <text
              attributes={TextAttributes.BOLD}
              fg={saving() ? theme.textMuted : focus.section === 4 && focus.actionIdx === 0 ? activeFg : theme.accent}
            >
              Save
            </text>
          </box>

          {/* Reset */}
          <box
            backgroundColor={focus.section === 4 && focus.actionIdx === 1 ? theme.primary : undefined}
            onMouseUp={() => resetAll()}
          >
            <text fg={focus.section === 4 && focus.actionIdx === 1 ? activeFg : theme.textMuted}>Reset</text>
          </box>

          {/* Cancel */}
          <box
            backgroundColor={focus.section === 4 && focus.actionIdx === 2 ? theme.primary : undefined}
            onMouseUp={() => dialog.clear()}
          >
            <text fg={focus.section === 4 && focus.actionIdx === 2 ? activeFg : theme.textMuted}>Cancel</text>
          </box>

          <Show when={focus.section === 4}>
            <text fg={theme.textMuted}>← → enter</text>
          </Show>
        </box>
      </box>
    </box>
  )
}
