import { produce } from "solid-js/store"
import { Clipboard } from "../../util/clipboard"
import { Editor } from "../../util/editor"
import { DialogStash } from "../dialog-stash"
import { DialogProvider as DialogProviderConnect } from "../dialog-provider"
import { restoreExtmarksFromParts, syncExtmarksWithPromptParts } from "./utils"
import { PromptActionContext } from "./usePromptActions"

// Extending action context or creating a new one. 
// Commands need access to actions (submit, pasteImage) and state setters.
export interface PromptCommandContext extends PromptActionContext {
    actions: {
        submit: () => Promise<void> | void
        pasteImage: (file: { filename?: string; content: string; mime: string }) => Promise<void>
    }
    command: any
    dialog: any
    stash: any
    renderer: any
    promptPartTypeId: number
}

export function usePromptCommands(ctx: PromptCommandContext) {

    ctx.command.register(() => {
        return [
            {
                title: "Clear prompt",
                value: "prompt.clear",
                category: "Prompt",
                disabled: true,
                onSelect: (dialog: any) => {
                    ctx.input.extmarks.clear()
                    ctx.input.clear()
                    dialog.clear()
                },
            },
            {
                title: "Submit prompt",
                value: "prompt.submit",
                disabled: true,
                keybind: "input_submit",
                category: "Prompt",
                onSelect: (dialog: any) => {
                    if (!ctx.input.focused) return
                    ctx.actions.submit()
                    dialog.clear()
                },
            },
            {
                title: "Paste",
                value: "prompt.paste",
                disabled: true,
                keybind: "input_paste",
                category: "Prompt",
                onSelect: async () => {
                    const content = await Clipboard.read()
                    if (content?.mime.startsWith("image/")) {
                        await ctx.actions.pasteImage({
                            filename: "clipboard",
                            mime: content.mime,
                            content: content.data,
                        })
                    }
                },
            },
            {
                title: "Interrupt session",
                value: "session.interrupt",
                keybind: "session_interrupt",
                disabled: ctx.sync.data.session_status?.[ctx.props.sessionID ?? ""]?.type === "idle",
                category: "Session",
                onSelect: (dialog: any) => {
                    if (ctx.autocomplete.visible) return
                    if (!ctx.input.focused) return
                    // TODO: this should be its own command
                    if (ctx.store.mode === "shell") {
                        ctx.setStore("mode", "normal")
                        return
                    }
                    if (!ctx.props.sessionID) return

                    ctx.setStore("interrupt", ctx.store.interrupt + 1)

                    setTimeout(() => {
                        ctx.setStore("interrupt", 0)
                    }, 5000)

                    if (ctx.store.interrupt >= 2) {
                        ctx.sdk.client.session.abort({
                            sessionID: ctx.props.sessionID,
                        })
                        ctx.setStore("interrupt", 0)
                    }
                    dialog.clear()
                },
            },
            {
                title: "Open editor",
                category: "Session",
                keybind: "editor_open",
                value: "prompt.editor",
                onSelect: async (dialog: any, trigger: any) => {
                    dialog.clear()

                    // replace summarized text parts with the actual text
                    const text = ctx.store.prompt.parts
                        .filter((p: any) => p.type === "text")
                        .reduce((acc: any, p: any) => {
                            if (!p.source) return acc
                            return acc.replace(p.source.text.value, p.text)
                        }, ctx.store.prompt.input)

                    const nonTextParts = ctx.store.prompt.parts.filter((p: any) => p.type !== "text")

                    const value = trigger === "prompt" ? "" : text
                    const content = await Editor.open({ value, renderer: ctx.renderer })
                    if (!content) return

                    ctx.input.setText(content)

                    // Update positions for nonTextParts based on their location in new content
                    const updatedNonTextParts = nonTextParts
                        .map((part: any) => {
                            let virtualText = ""
                            if (part.type === "file" && part.source?.text) {
                                virtualText = part.source.text.value
                            } else if (part.type === "agent" && part.source) {
                                virtualText = part.source.value
                            }

                            if (!virtualText) return part

                            const newStart = content.indexOf(virtualText)
                            // if the virtual text is deleted, remove the part
                            if (newStart === -1) return null

                            const newEnd = newStart + virtualText.length

                            if (part.type === "file" && part.source?.text) {
                                return {
                                    ...part,
                                    source: {
                                        ...part.source,
                                        text: {
                                            ...part.source.text,
                                            start: newStart,
                                            end: newEnd,
                                        },
                                    },
                                }
                            }

                            if (part.type === "agent" && part.source) {
                                return {
                                    ...part,
                                    source: {
                                        ...part.source,
                                        start: newStart,
                                        end: newEnd,
                                    },
                                }
                            }

                            return part
                        })
                        .filter((part: any) => part !== null)

                    ctx.setStore("prompt", {
                        input: content,
                        parts: updatedNonTextParts,
                    })
                    restoreExtmarksFromParts(
                        ctx.input,
                        updatedNonTextParts,
                        ctx.setStore,
                        ctx.fileStyleId,
                        ctx.agentStyleId,
                        ctx.pasteStyleId,
                        ctx.promptPartTypeId
                    )
                    ctx.input.cursorOffset = Bun.stringWidth(content)
                },
            },
        ]
    })

    ctx.command.register(() => [
        {
            title: "Stash prompt",
            value: "prompt.stash",
            category: "Prompt",
            disabled: !ctx.store.prompt.input,
            onSelect: (dialog: any) => {
                if (!ctx.store.prompt.input) return
                ctx.stash.push({
                    input: ctx.store.prompt.input,
                    parts: ctx.store.prompt.parts,
                })
                ctx.input.extmarks.clear()
                ctx.input.clear()
                ctx.setStore("prompt", { input: "", parts: [] })
                ctx.setStore("extmarkToPartIndex", new Map())
                dialog.clear()
            },
        },
        {
            title: "Stash pop",
            value: "prompt.stash.pop",
            category: "Prompt",
            disabled: ctx.stash.list().length === 0,
            onSelect: (dialog: any) => {
                const entry = ctx.stash.pop()
                if (entry) {
                    ctx.input.setText(entry.input)
                    ctx.setStore("prompt", { input: entry.input, parts: entry.parts })
                    restoreExtmarksFromParts(
                        ctx.input,
                        entry.parts,
                        ctx.setStore,
                        ctx.fileStyleId,
                        ctx.agentStyleId,
                        ctx.pasteStyleId,
                        ctx.promptPartTypeId
                    )
                    ctx.input.gotoBufferEnd()
                }
                dialog.clear()
            },
        },
        {
            title: "Stash list",
            value: "prompt.stash.list",
            category: "Prompt",
            disabled: ctx.stash.list().length === 0,
            onSelect: (dialog: any) => {
                dialog.replace(() => (
                    <DialogStash
                        onSelect={(entry) => {
                            ctx.input.setText(entry.input)
                            ctx.setStore("prompt", { input: entry.input, parts: entry.parts })
                            restoreExtmarksFromParts(
                                ctx.input,
                                entry.parts,
                                ctx.setStore,
                                ctx.fileStyleId,
                                ctx.agentStyleId,
                                ctx.pasteStyleId,
                                ctx.promptPartTypeId
                            )
                            ctx.input.gotoBufferEnd()
                        }}
                    />
                ))
            },
        },
    ])
}
