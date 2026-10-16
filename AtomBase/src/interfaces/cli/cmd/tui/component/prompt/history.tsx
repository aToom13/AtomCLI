import path from "path"
import { Global } from "@/core/global"
import { createEffect, createMemo, onMount } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { clone } from "remeda"
import { createSimpleContext } from "../../context/helper"
import { appendFile } from "fs/promises"
import type { AgentPart, FilePart, TextPart } from "@atomcli/sdk/v2"
import { useSync } from "../../context/sync"

export type PromptInfo = {
  input: string
  mode?: "normal" | "shell"
  parts: (
    | Omit<FilePart, "id" | "messageID" | "sessionID">
    | Omit<AgentPart, "id" | "messageID" | "sessionID">
    | (Omit<TextPart, "id" | "messageID" | "sessionID"> & {
        source?: {
          text: {
            start: number
            end: number
            value: string
          }
        }
      })
  )[]
}

const MAX_HISTORY_ENTRIES = 50
type HistoryEntry = PromptInfo & { directory?: string }

export function historyForDirectory(entries: HistoryEntry[], directory: string) {
  return entries.filter((entry) => entry.directory === directory).slice(-MAX_HISTORY_ENTRIES)
}

export const { use: usePromptHistory, provider: PromptHistoryProvider } = createSimpleContext({
  name: "PromptHistory",
  init: () => {
    const sync = useSync()
    const directory = createMemo(() => path.resolve(sync.data.path.directory || process.cwd()))
    const historyFile = Bun.file(path.join(Global.Path.state, "prompt-history.jsonl"))
    const loaded = historyFile.text().catch(() => "")
    const pending: HistoryEntry[] = []
    onMount(async () => {
      const text = await loaded
      const lines = text
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line)
          } catch {
            return null
          }
        })
        .filter(
          (line): line is HistoryEntry => line !== null && typeof line.input === "string" && Array.isArray(line.parts),
        )

      setStore("history", [...lines, ...pending])
      pending.length = 0
    })

    const [store, setStore] = createStore({
      index: 0,
      history: [] as HistoryEntry[],
    })
    createEffect(() => {
      directory()
      setStore("index", 0)
    })

    return {
      move(direction: 1 | -1, input: string) {
        const scoped = historyForDirectory(store.history, directory())
        if (!scoped.length) return undefined
        const current = scoped.at(store.index)
        if (!current) return undefined
        if (current.input !== input && input.length) return
        setStore(
          produce((draft) => {
            const next = store.index + direction
            if (Math.abs(next) > scoped.length) return
            if (next > 0) return
            draft.index = next
          }),
        )
        if (store.index === 0)
          return {
            input: "",
            parts: [],
          }
        return scoped.at(store.index)
      },
      append(item: PromptInfo) {
        const entry: HistoryEntry = { ...clone(item), directory: directory() }
        pending.push(entry)
        setStore(
          produce((draft) => {
            draft.history.push(entry)
            draft.index = 0
          }),
        )
        // ponytail: Append-only history avoids cross-process rewrite races; compact per directory if disk growth becomes material.
        void loaded.then(() => appendFile(historyFile.name!, JSON.stringify(entry) + "\n")).catch(() => {})
      },
    }
  },
})
