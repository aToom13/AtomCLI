import { Component, createEffect, on, Show, For } from "solid-js"
import { SetStoreFunction } from "solid-js/store"
import { Icon } from "@atomcli/ui/icon"
import { IconButton } from "@atomcli/ui/icon-button"
import { FileIcon } from "@atomcli/ui/file-icon"
import { getDirectory, getFilename } from "@atomcli/util/path"
import { usePrompt, Prompt as PromptType, ContentPart, ImageAttachmentPart } from "@/context/prompt"
import { useFile } from "@/context/file"
import { usePromptAttachments } from "./hooks/usePromptAttachments"
import { usePromptSuggestions } from "./hooks/usePromptSuggestions"
import { PromptPopover } from "./prompt-popover"
import {
    getCursorPosition,
    setCursorPosition,
    promptLength,
    createPill,
    createTextFragment,
    getNodeLength,
    setRangeEdge,
    isNormalizedEditor,
} from "./utils"
import { PLACEHOLDERS } from "./constants"
import { AtOption, SlashCommand } from "./types"
import { isPromptEqual } from "@/context/prompt"

interface PromptEditorProps {
    store: {
        popover: "at" | "slash" | null
        placeholder: number
        mode: "normal" | "shell"
        historyIndex?: number
        savedPrompt?: PromptType | null
        applyingHistory?: boolean
        dragging?: boolean
    }
    setStore: SetStoreFunction<{
        popover: "at" | "slash" | null
        placeholder: number
        mode: "normal" | "shell"
        [key: string]: any
    }>
    history: any
    working: boolean
    abort: () => void
    handleSubmit: (e: Event) => void
    imageAttachments: ImageAttachmentPart[]
    activeFile: string | undefined
    isFocused: () => boolean
    setRef: (el: HTMLDivElement) => void
    setScrollRef: (el: HTMLDivElement) => void
    queueScroll: () => void
}

export const PromptEditor: Component<PromptEditorProps> = (props) => {
    const prompt = usePrompt()
    const files = useFile()

    let editorRef: HTMLDivElement | undefined
    let slashPopoverRef: HTMLDivElement | undefined // If needed for scrolling, mostly internal to popover?

    const setEditorRef = (el: HTMLDivElement) => {
        editorRef = el
        props.setRef(el)
    }

    // Attachments Hook
    const { addImageAttachment, removeImageAttachment, handlePaste: handlePasteAttachment, dragging } = usePromptAttachments({
        editorRef: () => editorRef,
        addPart: (part) => addPart(part),
        isFocused: props.isFocused
    })

    // Sync dragging state
    createEffect(() => {
        props.setStore("dragging", dragging())
    })

    // Suggestions Hook
    // We need to implement onAtSelect/onSlashSelect logic here (inserting part)

    // NOTE: addPart is defined below, we hoist definition via function usage?
    // Const functions are not hoisted. We need to define addPart earlier or use `function`.

    // Let's define insertion logic helper
    const insertOption = (part: ContentPart) => {
        // similar to addPart but might replace text?
        // addPart handles replacement if text matches pattern?
        addPart(part)
    }

    const { at, slash, atKey } = usePromptSuggestions({
        onAtSelect: (option) => {
            if (!option) return
            if (option.type === "agent") {
                insertOption({ type: "agent", name: option.name, content: `@${option.name}`, start: 0, end: 0 })
            } else {
                insertOption({ type: "file", path: option.path, content: option.path, start: 0, end: 0 })
                // path content usually just path? original used path.
            }
        },
        onSlashSelect: (cmd) => {
            if (!cmd) return
            // Slash command selection simply sets text? 
            // Originally: sets store.mode to shell if cmd is shell?
            // Or inserts "/cmd "?

            // Slash command logic from prompt-input.tsx (viewed earlier? I might missed it)
            // Usually replaces "/typed" with "/cmd ".

            // Let's assume standard behavior:
            const content = `/${cmd.trigger} `
            insertOption({ type: "text", content, start: 0, end: 0 })
        }
    })

    const getCaretState = () => {
        if (!editorRef) return { collapsed: false, cursorPosition: 0, textLength: 0 }
        const selection = window.getSelection()
        // ...
        // Reuse previous implementation
        const textLength = promptLength(prompt.current())
        if (!selection || selection.rangeCount === 0) {
            return { collapsed: false, cursorPosition: 0, textLength }
        }
        const anchorNode = selection.anchorNode
        if (!anchorNode || !editorRef.contains(anchorNode)) {
            return { collapsed: false, cursorPosition: 0, textLength }
        }
        return {
            collapsed: selection.isCollapsed,
            cursorPosition: getCursorPosition(editorRef),
            textLength,
        }
    }

    // Copied from previous step
    const navigateHistory = (direction: "up" | "down") => {
        const apply = (p: PromptType, position: "start" | "end") => {
            const length = position === "start" ? 0 : promptLength(p)
            props.history.setApplying(true)
            prompt.set(p, length)
            requestAnimationFrame(() => {
                if (editorRef) {
                    editorRef.focus()
                    setCursorPosition(editorRef, length)
                    props.history.setApplying(false)
                    props.queueScroll()
                }
            })
        }
        return props.history.navigate(direction, props.store.mode, prompt.current(), apply)
    }

    const parseFromDOM = (): PromptType => {
        if (!editorRef) return []
        const parts: PromptType = []
        let position = 0
        let buffer = ""

        const flushText = () => {
            const content = buffer.replace(/\r\n?/g, "\n").replace(/\u200B/g, "")
            buffer = ""
            if (!content) return
            parts.push({ type: "text", content, start: position, end: position + content.length })
            position += content.length
        }

        const pushFile = (file: HTMLElement) => {
            const content = file.textContent ?? ""
            parts.push({
                type: "file",
                path: file.dataset.path!,
                content,
                start: position,
                end: position + content.length,
            })
            position += content.length
        }

        const pushAgent = (agent: HTMLElement) => {
            const content = agent.textContent ?? ""
            parts.push({
                type: "agent",
                name: agent.dataset.name!,
                content,
                start: position,
                end: position + content.length,
            })
            position += content.length
        }

        const visit = (node: Node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                buffer += node.textContent ?? ""
                return
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return

            const el = node as HTMLElement
            if (el.dataset.type === "file") {
                flushText()
                pushFile(el)
                return
            }
            if (el.dataset.type === "agent") {
                flushText()
                pushAgent(el)
                return
            }
            if (el.tagName === "BR") {
                buffer += "\n"
                return
            }

            for (const child of Array.from(el.childNodes)) {
                visit(child)
            }
        }

        const children = Array.from(editorRef.childNodes)
        children.forEach((child, index) => {
            const isBlock = child.nodeType === Node.ELEMENT_NODE && ["DIV", "P"].includes((child as HTMLElement).tagName)
            visit(child)
            if (isBlock && index < children.length - 1) {
                buffer += "\n"
            }
        })

        flushText()

        if (parts.length === 0) return []
        return parts
    }

    const handleInput = () => {
        if (!editorRef) return
        const rawParts = parseFromDOM()
        const images = props.imageAttachments
        const cursorPosition = getCursorPosition(editorRef)
        const rawText = rawParts.map((p) => ("content" in p ? p.content : "")).join("")
        const trimmed = rawText.replace(/\u200B/g, "").trim()
        const hasNonText = rawParts.some((part) => part.type !== "text")
        const shouldReset = trimmed.length === 0 && !hasNonText && images.length === 0

        if (shouldReset) {
            props.setStore("popover", null)
            if ((props.store.historyIndex ?? -1) >= 0 && !props.store.applyingHistory) {
                props.setStore("historyIndex", -1)
                props.setStore("savedPrompt", null)
            }

            if (prompt.dirty()) {
                prompt.reset()
            }
            props.queueScroll()
            return
        }

        const shellMode = props.store.mode === "shell"

        if (!shellMode) {
            const atMatch = rawText.substring(0, cursorPosition).match(/@(\S*)$/)
            const slashMatch = rawText.match(/^\/(\S*)$/)

            if (atMatch) {
                at.onInput(atMatch[1])
                props.setStore("popover", "at")
            } else if (slashMatch) {
                slash.onInput(slashMatch[1])
                props.setStore("popover", "slash")
            } else {
                props.setStore("popover", null)
            }
        } else {
            props.setStore("popover", null)
        }

        if (props.history.state.index >= 0 && !props.history.state.applying) {
            props.history.reset()
        }

        prompt.set([...rawParts, ...props.imageAttachments], cursorPosition)
        props.queueScroll()
    }

    const addPart = (part: ContentPart) => {
        if (!editorRef) return
        const selection = window.getSelection()
        if (!selection || selection.rangeCount === 0) return

        const cursorPosition = getCursorPosition(editorRef)
        const currentPrompt = prompt.current()
        const rawText = currentPrompt.map((p) => ("content" in p ? p.content : "")).join("")
        const textBeforeCursor = rawText.substring(0, cursorPosition)
        const atMatch = textBeforeCursor.match(/@(\S*)$/)

        // Need to handle slash command replacement too?
        // textBeforeCursor is needed to find where to insert.
        const slashMatch = textBeforeCursor.match(/^\/(\S*)$/)

        if (part.type === "file" || part.type === "agent") {
            const pill = createPill(part)
            const gap = document.createTextNode(" ")
            const range = selection.getRangeAt(0)

            if (atMatch) {
                const start = atMatch.index ?? cursorPosition - atMatch[0].length
                setRangeEdge(editorRef, range, "start", start)
                setRangeEdge(editorRef, range, "end", cursorPosition)
            }

            range.deleteContents()
            range.insertNode(gap)
            range.insertNode(pill)
            range.setStartAfter(gap)
            range.collapse(true)
            selection.removeAllRanges()
            selection.addRange(range)
        } else if (part.type === "text") {
            const range = selection.getRangeAt(0)

            // Handle slash replacement
            if (slashMatch && part.content.startsWith("/")) { // Simple check
                const start = slashMatch.index ?? 0
                setRangeEdge(editorRef, range, "start", start)
                setRangeEdge(editorRef, range, "end", cursorPosition)
                range.deleteContents()
            }

            const fragment = createTextFragment(part.content)
            const last = fragment.lastChild
            range.insertNode(fragment)
            if (last) {
                if (last.nodeType === Node.TEXT_NODE) {
                    const text = last.textContent ?? ""
                    if (text === "\u200B") {
                        range.setStart(last, 0)
                    } else {
                        range.setStart(last, text.length)
                    }
                } else {
                    range.setStartAfter(last)
                }
            }
            range.collapse(true)
            selection.removeAllRanges()
            selection.addRange(range)
        }

        handleInput()
        props.setStore("popover", null)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
        if (!editorRef) return
        if (event.key === "Backspace") {
            const selection = window.getSelection()
            if (selection && selection.isCollapsed) {
                const node = selection.anchorNode
                const offset = selection.anchorOffset
                if (node && node.nodeType === Node.TEXT_NODE) {
                    const text = node.textContent ?? ""
                    if (/^\u200B+$/.test(text) && offset > 0) {
                        const range = document.createRange()
                        range.setStart(node, 0)
                        range.collapse(true)
                        selection.removeAllRanges()
                        selection.addRange(range)
                    }
                }
            }
        }

        if (event.key === "!" && props.store.mode === "normal") {
            const cursorPosition = getCursorPosition(editorRef)
            if (cursorPosition === 0) {
                props.setStore("mode", "shell")
                props.setStore("popover", null)
                event.preventDefault()
                return
            }
        }
        if (props.store.mode === "shell") {
            const { collapsed, cursorPosition, textLength } = getCaretState()
            if (event.key === "Escape") {
                props.setStore("mode", "normal")
                event.preventDefault()
                return
            }
            if (event.key === "Backspace" && collapsed && cursorPosition === 0 && textLength === 0) {
                props.setStore("mode", "normal")
                event.preventDefault()
                return
            }
        }

        if (event.key === "Enter" && event.isComposing) {
            return
        }

        if (props.store.popover && (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter")) {
            if (props.store.popover === "at") {
                at.onKeyDown(event)
            } else {
                slash.onKeyDown(event)
            }
            event.preventDefault()
            return
        }

        const ctrl = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey

        if (ctrl && event.code === "KeyG") {
            if (props.store.popover) {
                props.setStore("popover", null)
                event.preventDefault()
                return
            }
            if (props.working) {
                props.abort()
                event.preventDefault()
            }
            return
        }

        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            if (event.altKey || event.ctrlKey || event.metaKey) return
            const { collapsed } = getCaretState()
            if (!collapsed) return

            const cursorPosition = getCursorPosition(editorRef)
            const textLength = promptLength(prompt.current())
            const textContent = prompt
                .current()
                .map((part) => ("content" in part ? part.content : ""))
                .join("")
            const isEmpty = textContent.trim() === "" || textLength <= 1
            const hasNewlines = textContent.includes("\n")
            const inHistory = props.history.state.index >= 0
            const atStart = cursorPosition <= (isEmpty ? 1 : 0)
            const atEnd = cursorPosition >= (isEmpty ? textLength - 1 : textLength)
            const allowUp = isEmpty || atStart || (!hasNewlines && !inHistory) || (inHistory && atEnd)
            const allowDown = isEmpty || atEnd || (!hasNewlines && !inHistory) || (inHistory && atStart)

            if (event.key === "ArrowUp") {
                if (!allowUp) return
                if (navigateHistory("up")) event.preventDefault()
                return
            }

            if (navigateHistory("down")) event.preventDefault()
            return
        }

        if (event.key === "Enter" && event.shiftKey) {
            addPart({ type: "text", content: "\n", start: 0, end: 0 })
            event.preventDefault()
            return
        }
        if (event.key === "Enter" && !event.shiftKey) {
            props.handleSubmit(event)
        }
    }

    const renderEditor = (parts: PromptType) => {
        if (!editorRef) return
        editorRef.innerHTML = ""
        for (const part of parts) {
            if (part.type === "text") {
                editorRef.appendChild(createTextFragment(part.content))
                continue
            }
            if (part.type === "file" || part.type === "agent") {
                editorRef.appendChild(createPill(part))
            }
        }
    }

    createEffect(
        on(
            () => prompt.current(),
            (currentParts) => {
                const inputParts = currentParts.filter((part) => part.type !== "image") as PromptType
                const domParts = parseFromDOM()
                if (editorRef && isNormalizedEditor(editorRef) && isPromptEqual(inputParts, domParts)) {
                    return
                }

                const selection = window.getSelection()
                let cursorPosition: number | null = null
                if (editorRef && selection && selection.rangeCount > 0 && editorRef.contains(selection.anchorNode)) {
                    cursorPosition = getCursorPosition(editorRef)
                }

                renderEditor(inputParts)

                if (cursorPosition !== null && editorRef) {
                    setCursorPosition(editorRef, cursorPosition)
                }
            },
        ),
    )

    return (
        <>
            <PromptPopover
                popover={props.store.popover}
                setPopoverRef={(el) => slashPopoverRef = el}
                atList={at.list()} // use call() or access prop? 
                // at is filteredList. check hooks/usePromptSuggestions definition
                // at is returned as `at`. In useFilteredList `at` is object. `at.list` is signal accessor?
                // Checked usePromptSuggestions: `return { at, slash, atKey }`. `at` is from `useFilteredList`.
                // `useFilteredList` returns `{ list: Accessor<T[]>, ... }`. So `at.list()` is correct.
                atActive={at.active()}
                atKey={atKey}
                handleAtSelect={at.select}
                setAtActive={at.setActive}
                slashList={slash.list()}
                slashActive={slash.active()}
                handleSlashSelect={slash.select}
                setSlashActive={slash.setActive}
            />

            <Show when={props.store.dragging}>
                <div class="absolute inset-0 z-10 flex items-center justify-center bg-surface-raised-stronger-non-alpha/90 pointer-events-none">
                    <div class="flex flex-col items-center gap-2 text-text-weak">
                        <Icon name="photo" class="size-8" />
                        <span class="text-14-regular">Drop images or PDFs here</span>
                    </div>
                </div>
            </Show>

            {/* Context Items */}
            <Show when={(prompt.context.items().length > 0 || !!props.activeFile)}>
                <div class="flex flex-wrap items-center gap-2 px-3 pt-3">
                    <Show when={prompt.context.activeTab() ? props.activeFile : undefined}>
                        <div class="flex items-center gap-2 px-2 py-1 rounded-md bg-surface-base border border-border-base max-w-full">
                            <FileIcon node={{ path: props.activeFile!, type: "file" }} class="shrink-0 size-4" />
                            <div class="flex items-center text-12-regular min-w-0">
                                <span class="text-text-weak whitespace-nowrap truncate min-w-0">{getDirectory(props.activeFile!)}</span>
                                <span class="text-text-strong whitespace-nowrap">{getFilename(props.activeFile!)}</span>
                                <span class="text-text-weak whitespace-nowrap ml-1">active</span>
                            </div>
                            <IconButton
                                type="button"
                                icon="close"
                                variant="ghost"
                                class="h-6 w-6"
                                onClick={() => prompt.context.removeActive()}
                            />
                        </div>
                    </Show>
                    <Show when={!prompt.context.activeTab() && !!props.activeFile}>
                        <button
                            type="button"
                            class="flex items-center gap-2 px-2 py-1 rounded-md bg-surface-base border border-border-base text-12-regular text-text-weak hover:bg-surface-raised-base-hover"
                            onClick={() => prompt.context.addActive()}
                        >
                            <Icon name="plus-small" size="small" />
                            <span>Include active file</span>
                        </button>
                    </Show>
                    <For each={prompt.context.items()}>
                        {(item) => (
                            <div class="flex items-center gap-2 px-2 py-1 rounded-md bg-surface-base border border-border-base max-w-full">
                                <FileIcon node={{ path: item.path, type: "file" }} class="shrink-0 size-4" />
                                <div class="flex items-center text-12-regular min-w-0">
                                    <span class="text-text-weak whitespace-nowrap truncate min-w-0">{getDirectory(item.path)}</span>
                                    <span class="text-text-strong whitespace-nowrap">{getFilename(item.path)}</span>
                                    <Show when={item.selection}>
                                        {(sel) => (
                                            <span class="text-text-weak whitespace-nowrap ml-1">
                                                {sel().startLine === sel().endLine
                                                    ? `:${sel().startLine}`
                                                    : `:${sel().startLine}-${sel().endLine}`}
                                            </span>
                                        )}
                                    </Show>
                                </div>
                                <IconButton
                                    type="button"
                                    icon="close"
                                    variant="ghost"
                                    class="h-6 w-6"
                                    onClick={() => prompt.context.remove(item.key)}
                                />
                            </div>
                        )}
                    </For>
                </div>
            </Show>

            {/* Attachments */}
            <Show when={props.imageAttachments.length > 0}>
                <div class="flex flex-wrap gap-2 px-3 pt-3">
                    <For each={props.imageAttachments}>
                        {(attachment) => (
                            <div class="relative group">
                                <Show
                                    when={attachment.mime.startsWith("image/")}
                                    fallback={
                                        <div class="size-16 rounded-md bg-surface-base flex items-center justify-center border border-border-base">
                                            <Icon name="folder" class="size-6 text-text-weak" />
                                        </div>
                                    }
                                >
                                    <img
                                        src={attachment.dataUrl}
                                        alt={attachment.filename}
                                        class="size-16 rounded-md object-cover border border-border-base"
                                    />
                                </Show>
                                <button
                                    type="button"
                                    onClick={() => removeImageAttachment(attachment.id)}
                                    class="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-surface-raised-stronger-non-alpha border border-border-base flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-raised-base-hover"
                                >
                                    <Icon name="close" class="size-3 text-text-weak" />
                                </button>
                                <div class="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/50 rounded-b-md">
                                    <span class="text-10-regular text-white truncate block">{attachment.filename}</span>
                                </div>
                            </div>
                        )}
                    </For>
                </div>
            </Show>

            <div class="relative max-h-[240px] overflow-y-auto" ref={(el) => props.setScrollRef(el)}>
                <div
                    data-component="prompt-input"
                    ref={setEditorRef}
                    contenteditable="true"
                    onInput={handleInput}
                    onPaste={handlePasteAttachment}
                    onKeyDown={handleKeyDown}
                    classList={{
                        "select-text": true,
                        "w-full px-5 py-3 pr-12 text-14-regular text-text-strong focus:outline-none whitespace-pre-wrap": true,
                        "[&_[data-type=file]]:text-syntax-property": true,
                        "[&_[data-type=agent]]:text-syntax-type": true,
                        "font-mono!": props.store.mode === "shell",
                    }}
                />
                <Show when={!prompt.dirty()}>
                    <div class="absolute top-0 inset-x-0 px-5 py-3 pr-12 text-14-regular text-text-weak pointer-events-none whitespace-nowrap truncate">
                        {props.store.mode === "shell"
                            ? "Enter shell command..."
                            : `Ask anything... "${PLACEHOLDERS[props.store.placeholder]}"`}
                    </div>
                </Show>
            </div>
        </>
    )
}
