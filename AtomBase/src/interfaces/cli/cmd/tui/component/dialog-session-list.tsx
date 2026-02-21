import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, createResource, onMount, Show } from "solid-js"
import { Locale } from "@/util/util/locale"
import { Keybind } from "@/util/util/keybind"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { DialogSessionRename } from "./dialog-session-rename"
import { useKV } from "../context/kv"
import { createDebouncedSignal } from "../util/signal"
import "opentui-spinner/solid"

export function DialogSessionList() {
  const dialog = useDialog()
  const sync = useSync()
  const { theme } = useTheme()
  const route = useRoute()
  const sdk = useSDK()
  const kv = useKV()

  const [toDelete, setToDelete] = createSignal<string>()
  const [search, setSearch] = createDebouncedSignal("", 150)

  const [searchResults] = createResource(search, async (query) => {
    if (!query) return undefined
    const result = await sdk.client.session.list({ search: query, limit: 30 })
    return result.data ?? []
  })

  const deleteKeybind = "ctrl+d"
  const pinKeybind = "ctrl+p"

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

  // Pinned sessions stored in KV as a comma-separated string
  const [pinnedRaw, setPinnedRaw] = kv.signal("pinned_sessions", "")
  const pinnedSet = createMemo(() => {
    const raw = pinnedRaw()
    if (!raw) return new Set<string>()
    return new Set(raw.split(",").filter(Boolean))
  })

  function togglePin(sessionID: string) {
    const current = pinnedSet()
    if (current.has(sessionID)) {
      current.delete(sessionID)
    } else {
      current.add(sessionID)
    }
    setPinnedRaw(Array.from(current).join(",") as any)
  }

  const sessions = createMemo(() => searchResults() ?? sync.data.session)

  const options = createMemo(() => {
    const today = new Date().toDateString()
    const pinned = pinnedSet()

    return sessions()
      .filter((x) => x.parentID === undefined)
      .toSorted((a, b) => {
        // Pinned sessions first
        const aPinned = pinned.has(a.id)
        const bPinned = pinned.has(b.id)
        if (aPinned && !bPinned) return -1
        if (!aPinned && bPinned) return 1
        // Then by updated time
        return b.time.updated - a.time.updated
      })
      .map((x) => {
        const date = new Date(x.time.updated)
        const isPinned = pinned.has(x.id)
        let category = isPinned ? "📌 Pinned" : date.toDateString()
        if (category === today) {
          category = "Today"
        }
        const isDeleting = toDelete() === x.id
        const status = sync.data.session_status?.[x.id]
        const isWorking = status?.type === "busy"
        return {
          title: isDeleting
            ? `Press ${deleteKeybind} again to confirm`
            : (isPinned ? "📌 " : "") + x.title,
          bg: isDeleting ? theme.error : undefined,
          value: x.id,
          category,
          footer: Locale.time(x.time.updated),
          gutter: isWorking ? (
            <Show when={kv.get("animations_enabled", true)} fallback={<text fg={theme.textMuted}>[⋯]</text>}>
              <spinner frames={spinnerFrames} interval={80} color={theme.primary} />
            </Show>
          ) : undefined,
        }
      })
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title="Sessions"
      options={options()}
      skipFilter={true}
      current={currentSessionID()}
      onFilter={setSearch}
      onMove={() => {
        setToDelete(undefined)
      }}
      onSelect={(option) => {
        route.navigate({
          type: "session",
          sessionID: option.value,
        })
        dialog.clear()
      }}
      keybind={[
        {
          keybind: Keybind.parse(deleteKeybind)[0],
          title: "delete",
          onTrigger: async (option) => {
            if (toDelete() === option.value) {
              sdk.client.session.delete({
                sessionID: option.value,
              })
              setToDelete(undefined)
              return
            }
            setToDelete(option.value)
          },
        },
        {
          keybind: Keybind.parse("ctrl+r")[0],
          title: "rename",
          onTrigger: async (option) => {
            dialog.replace(() => <DialogSessionRename session={option.value} />)
          },
        },
        {
          keybind: Keybind.parse(pinKeybind)[0],
          title: "pin/unpin",
          onTrigger: async (option) => {
            togglePin(option.value)
          },
        },
      ]}
    />
  )
}
