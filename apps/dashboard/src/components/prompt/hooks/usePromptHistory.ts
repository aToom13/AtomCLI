import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { type Prompt, DEFAULT_PROMPT, isPromptEqual } from "@/context/prompt"

const MAX_HISTORY = 100

export function usePromptHistory() {
    const [state, setState] = createStore({
        index: -1,
        savedPrompt: null as Prompt | null,
        applying: false,
    })

    const [history, setHistory] = persisted(
        Persist.global("prompt-history", ["prompt-history.v1"]),
        createStore<{ entries: Prompt[] }>({ entries: [] })
    )

    const [shellHistory, setShellHistory] = persisted(
        Persist.global("prompt-history-shell", ["prompt-history-shell.v1"]),
        createStore<{ entries: Prompt[] }>({ entries: [] })
    )

    const clonePromptParts = (prompt: Prompt): Prompt =>
        prompt.map((part) => {
            if (part.type === "text") return { ...part }
            if (part.type === "image") return { ...part }
            if (part.type === "agent") return { ...part }
            return {
                ...part,
                selection: part.selection ? { ...part.selection } : undefined,
            }
        })

    const add = (prompt: Prompt, mode: "normal" | "shell") => {
        const text = prompt
            .map((p) => ("content" in p ? p.content : ""))
            .join("")
            .trim()
        const hasImages = prompt.some((part) => part.type === "image")
        if (!text && !hasImages) return

        const entry = clonePromptParts(prompt)
        const currentHistory = mode === "shell" ? shellHistory : history
        const setCurrentHistory = mode === "shell" ? setShellHistory : setHistory
        const lastEntry = currentHistory.entries[0]
        if (lastEntry && isPromptEqual(lastEntry, entry)) return

        setCurrentHistory("entries", (entries) => [entry, ...entries].slice(0, MAX_HISTORY))
    }

    const navigate = (
        direction: "up" | "down",
        mode: "normal" | "shell",
        currentPrompt: Prompt,
        applyPrompt: (p: Prompt, position: "start" | "end") => void
    ) => {
        const entries = mode === "shell" ? shellHistory.entries : history.entries
        const current = state.index

        if (direction === "up") {
            if (entries.length === 0) return false
            if (current === -1) {
                setState("savedPrompt", clonePromptParts(currentPrompt))
                setState("index", 0)
                applyPrompt(entries[0], "start")
                return true
            }
            if (current < entries.length - 1) {
                const next = current + 1
                setState("index", next)
                applyPrompt(entries[next], "start")
                return true
            }
            return false
        }

        if (current > 0) {
            const next = current - 1
            setState("index", next)
            applyPrompt(entries[next], "end")
            return true
        }
        if (current === 0) {
            setState("index", -1)
            const saved = state.savedPrompt
            if (saved) {
                applyPrompt(saved, "end")
                setState("savedPrompt", null)
                return true
            }
            applyPrompt(DEFAULT_PROMPT, "end")
            return true
        }

        return false
    }

    const reset = () => {
        setState({ index: -1, savedPrompt: null, applying: false })
    }

    const setApplying = (applying: boolean) => setState("applying", applying)

    return {
        state,
        add,
        navigate,
        reset,
        setApplying,
    }
}
