import type { ContentPart, FileAttachmentPart, AgentPart, Prompt } from "@/context/prompt"

export const promptLength = (prompt: Prompt) =>
    prompt.reduce((len, part) => len + ("content" in part ? part.content.length : 0), 0)

export const getCursorPosition = (element: Element | undefined) => {
    if (!element) return 0
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return 0

    if (!element.contains(selection.anchorNode)) return 0

    const range = selection.getRangeAt(0)
    const preCaretRange = range.cloneRange()
    preCaretRange.selectNodeContents(element)
    preCaretRange.setEnd(range.startContainer, range.startOffset)
    return preCaretRange.toString().length
}

export const setCursorPosition = (element: Element | undefined, position: number) => {
    if (!element) return
    let charIndex = 0
    const range = document.createRange()
    range.setStart(element, 0)
    range.collapse(true)
    const nodeStack = [element]
    let node: Node | undefined
    let found = false

    while (!found && (node = nodeStack.pop())) {
        if (node.nodeType === Node.TEXT_NODE) {
            const nextCharIndex = charIndex + (node.textContent?.length || 0)
            if (!found && position >= charIndex && position <= nextCharIndex) {
                range.setStart(node, position - charIndex)
                range.collapse(true)
                found = true
            }
            charIndex = nextCharIndex
        } else {
            let i = node.childNodes.length
            while (i--) {
                nodeStack.push(node.childNodes[i])
            }
        }
    }

    const selection = window.getSelection()
    if (selection) {
        selection.removeAllRanges()
        selection.addRange(range)
    }
}

export const scrollCursorIntoView = (
    container: HTMLElement | undefined,
    editor: HTMLElement | undefined,
) => {
    if (!container || !editor) return
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return

    const range = selection.getRangeAt(0)
    if (!editor.contains(range.startContainer)) return

    const rect = range.getBoundingClientRect()
    if (!rect.height) return

    const containerRect = container.getBoundingClientRect()
    const top = rect.top - containerRect.top + container.scrollTop
    const bottom = rect.bottom - containerRect.top + container.scrollTop
    const padding = 12

    if (top < container.scrollTop + padding) {
        container.scrollTop = Math.max(0, top - padding)
        return
    }

    if (bottom > container.scrollTop + container.clientHeight - padding) {
        container.scrollTop = bottom - container.clientHeight + padding
    }
}

export const getNodeLength = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0
    if (node.nodeType !== Node.ELEMENT_NODE) return 0
    const el = node as HTMLElement
    if (el.dataset.type === "file" || el.dataset.type === "agent") return el.textContent?.length ?? 0
    if (el.tagName === "BR") return 1
    return 0
}

export const createTextFragment = (text: string) => {
    const fragment = document.createDocumentFragment()
    let hasContent = false
    const parts = text.split("\n")

    parts.forEach((part, index) => {
        if (index > 0) {
            fragment.appendChild(document.createElement("br"))
        }
        if (part) {
            fragment.appendChild(document.createTextNode(part))
            hasContent = true
        }
    })

    if (!hasContent) {
        fragment.appendChild(document.createTextNode("\u200B"))
    }

    return fragment
}

export const createPill = (part: FileAttachmentPart | AgentPart) => {
    const pill = document.createElement("span")
    pill.textContent = part.content
    pill.setAttribute("data-type", part.type)
    if (part.type === "file") pill.setAttribute("data-path", part.path)
    if (part.type === "agent") pill.setAttribute("data-name", part.name)
    pill.setAttribute("contenteditable", "false")
    pill.style.userSelect = "text"
    pill.style.cursor = "default"
    return pill
}

export const isNormalizedEditor = (editor: HTMLElement) =>
    Array.from(editor.childNodes).every((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent ?? ""
            if (!text.includes("\u200B")) return true
            if (text !== "\u200B") return false

            const prev = node.previousSibling
            const next = node.nextSibling
            const prevIsBr = prev?.nodeType === Node.ELEMENT_NODE && (prev as HTMLElement).tagName === "BR"
            const nextIsBr = next?.nodeType === Node.ELEMENT_NODE && (next as HTMLElement).tagName === "BR"
            if (!prevIsBr && !nextIsBr) return false
            if (nextIsBr && !prevIsBr && prev) return false
            return true
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return false
        const el = node as HTMLElement
        if (el.dataset.type === "file") return true
        if (el.dataset.type === "agent") return true
        return el.tagName === "BR"
    })

export const setRangeEdge = (element: HTMLElement, range: Range, edge: "start" | "end", offset: number) => {
    let remaining = offset
    const nodes = Array.from(element.childNodes)

    for (const node of nodes) {
        const length = getNodeLength(node)
        const isText = node.nodeType === Node.TEXT_NODE
        const isPill =
            node.nodeType === Node.ELEMENT_NODE &&
            ((node as HTMLElement).dataset.type === "file" || (node as HTMLElement).dataset.type === "agent")
        const isBreak = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR"

        if (isText && remaining <= length) {
            if (edge === "start") range.setStart(node, remaining)
            if (edge === "end") range.setEnd(node, remaining)
            return
        }

        if ((isPill || isBreak) && remaining <= length) {
            if (edge === "start" && remaining === 0) range.setStartBefore(node)
            if (edge === "start" && remaining > 0) range.setStartAfter(node)
            if (edge === "end" && remaining === 0) range.setEndBefore(node)
            if (edge === "end" && remaining > 0) range.setEndAfter(node)
            return
        }

        remaining -= length
    }
}
