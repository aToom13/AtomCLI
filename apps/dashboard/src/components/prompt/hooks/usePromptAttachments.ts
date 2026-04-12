import { createSignal, onCleanup, onMount } from "solid-js"
import { type Prompt, type ImageAttachmentPart, type ContentPart, usePrompt } from "@/context/prompt"
import { useDialog } from "@atomcli/ui/context/dialog"
import { ACCEPTED_FILE_TYPES } from "../constants"
import { createFocusSignal } from "@solid-primitives/active-element"

export function usePromptAttachments(props: {
    editorRef: () => HTMLDivElement | undefined
    addPart: (part: ContentPart) => void
    isFocused: () => boolean
}) {
    const prompt = usePrompt()
    const dialog = useDialog()
    const [dragging, setDragging] = createSignal(false)

    const getCursorPosition = (element: Element | undefined) => {
        if (!element) return 0
        const selection = window.getSelection()
        if (!selection || selection.rangeCount === 0) return 0
        const range = selection.getRangeAt(0)
        const preCaretRange = range.cloneRange()
        preCaretRange.selectNodeContents(element)
        preCaretRange.setEnd(range.startContainer, range.startOffset)
        return preCaretRange.toString().length
    }

    const addImageAttachment = async (file: File) => {
        if (!ACCEPTED_FILE_TYPES.includes(file.type)) return

        const reader = new FileReader()
        reader.onload = () => {
            const dataUrl = reader.result as string
            const attachment: ImageAttachmentPart = {
                type: "image",
                id: crypto.randomUUID(),
                filename: file.name,
                mime: file.type,
                dataUrl,
            }
            const cursorPosition = prompt.cursor() ?? getCursorPosition(props.editorRef())
            prompt.set([...prompt.current(), attachment], cursorPosition)
        }
        reader.readAsDataURL(file)
    }

    const removeImageAttachment = (id: string) => {
        const current = prompt.current()
        const next = current.filter((part) => part.type !== "image" || part.id !== id)
        prompt.set(next, prompt.cursor())
    }

    const handlePaste = async (event: ClipboardEvent) => {
        if (!props.isFocused()) return
        const clipboardData = event.clipboardData
        if (!clipboardData) return

        // Allow default behavior for text, but prevent if we handle files
        const items = Array.from(clipboardData.items)
        const imageItems = items.filter((item) => ACCEPTED_FILE_TYPES.includes(item.type))

        if (imageItems.length > 0) {
            event.preventDefault()
            event.stopPropagation()
            for (const item of imageItems) {
                const file = item.getAsFile()
                if (file) await addImageAttachment(file)
            }
            return
        }

        // Text handling is done by default behavior/addPart in parent if needed, 
        // but here we just handle files or let it pass for text
        const plainText = clipboardData.getData("text/plain") ?? ""
        if (plainText && imageItems.length === 0) {
            // Parent logic handled plain text paste by preventing default and using addPart.
            // We might want to move that here or keep it separate.
            // For now, let's replicate the parent logic:
            event.preventDefault()
            event.stopPropagation()
            props.addPart({ type: "text", content: plainText, start: 0, end: 0 })
        }
    }

    const handleGlobalDragOver = (event: DragEvent) => {
        if (dialog.active) return

        event.preventDefault()
        const hasFiles = event.dataTransfer?.types.includes("Files")
        if (hasFiles) {
            setDragging(true)
        }
    }

    const handleGlobalDragLeave = (event: DragEvent) => {
        if (dialog.active) return

        // relatedTarget is null when leaving the document window
        if (!event.relatedTarget) {
            setDragging(false)
        }
    }

    const handleGlobalDrop = async (event: DragEvent) => {
        if (dialog.active) return

        event.preventDefault()
        setDragging(false)

        const dropped = event.dataTransfer?.files
        if (!dropped) return

        for (const file of Array.from(dropped)) {
            if (ACCEPTED_FILE_TYPES.includes(file.type)) {
                await addImageAttachment(file)
            }
        }
    }

    onMount(() => {
        document.addEventListener("dragover", handleGlobalDragOver)
        document.addEventListener("dragleave", handleGlobalDragLeave)
        document.addEventListener("drop", handleGlobalDrop)
    })

    onCleanup(() => {
        document.removeEventListener("dragover", handleGlobalDragOver)
        document.removeEventListener("dragleave", handleGlobalDragLeave)
        document.removeEventListener("drop", handleGlobalDrop)
    })

    return {
        dragging,
        addImageAttachment,
        removeImageAttachment,
        handlePaste,
    }
}
