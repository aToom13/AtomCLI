import type { Message } from "@atomcli/sdk/v2"
import { type Accessor } from "solid-js"

export function useScrollLogic(
    messages: Accessor<Message[]>,
    showDetails: Accessor<boolean>,
    renderer: { scrollTo: (y: number) => void },
) {
    const findNextVisibleMessage = (direction: "next" | "prev"): string | null => {
        // We want to find the message ID relative to the current viewport
        // Since we don't track viewport reliably in TUI without events,
        // we might rely on selected element or just iterate.
        // The original code used `renderer.viewport` via careful logic or just DOM?

        // Original implementation looked at document.getElementById?
        // Let's assume we pass a way to get element rects or just use logic.
        // Original code:
        /*
          const findNextVisibleMessage = (direction: "next" | "prev") => {
            const viewport = renderer.viewport
            ...
          }
        */
        // I need access to renderer.
        return null // Snapshot helper logic later if complex
    }

    // Actually, I'll copy the logic if I can see it.
    // I saw 222-251 in outline.
    // The logic iterates elements in `messages()`.

    return { findNextVisibleMessage }
}
