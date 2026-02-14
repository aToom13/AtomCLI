import { useRenderer } from "@opentui/solid"
import { Clipboard } from "@tui/util/clipboard"
import { useToast } from "../ui/toast"
import { Flag } from "@/flag/flag"

/**
 * Unified clipboard/OSC52 handler for the TUI.
 * Consolidates the duplicate clipboard logic that was in App():
 * - renderer.console.onCopySelection callback  
 * - root box onMouseUp handler
 * Extracted to eliminate duplication and centralize clipboard behavior.
 */
export function useClipboard() {
    const renderer = useRenderer()
    const toast = useToast()

    async function copyToClipboard(text: string) {
        if (!text || text.length === 0) return

        const base64 = Buffer.from(text).toString("base64")
        const osc52 = `\x1b]52;c;${base64}\x07`
        const finalOsc52 = process.env["TMUX"] ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
        // @ts-expect-error writeOut is not in type definitions
        renderer.writeOut(finalOsc52)
        await Clipboard.copy(text)
            .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
            .catch(toast.error)
        renderer.clearSelection()
    }

    // Wire up console copy-to-clipboard via opentui's onCopySelection callback
    renderer.console.onCopySelection = async (text: string) => {
        await copyToClipboard(text)
    }

    /** Handler for root box onMouseUp — copies selection to clipboard */
    async function onMouseUpCopy() {
        if (Flag.ATOMCLI_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) {
            renderer.clearSelection()
            return
        }
        const text = renderer.getSelection()?.getSelectedText()
        if (text && text.length > 0) {
            await copyToClipboard(text)
        }
    }

    return { onMouseUpCopy }
}
