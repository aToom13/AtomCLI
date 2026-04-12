import { produce } from "solid-js/store"
import { Identifier } from "@/id/id"
import { iife } from "@/util/iife"
import type { FilePart } from "@atomcli/sdk/v2"
import type { PromptProps } from "./types"

// We need to pass a lot of context to these actions. 
// Defining a context object to keep signatures clean.
export type PromptActionContext = {
    props: PromptProps
    store: any
    setStore: any
    input: any // TextareaRenderable
    autocomplete: any // AutocompleteRef
    local: any
    sdk: any
    sync: any
    route: any
    history: any
    exit: any
    toast?: any // Toast context for showing notifications
    dialog?: any // Dialog context for showing dialogs
    promptPartTypeId: number
    fileStyleId: number
    agentStyleId: number
    pasteStyleId: number
}

export function usePromptActions(ctx: PromptActionContext) {

    async function submit() {
        if (ctx.props.disabled) return
        if (ctx.autocomplete?.visible) return
        if (!ctx.store.prompt.input) return
        const trimmed = ctx.store.prompt.input.trim()
        if (trimmed === "exit" || trimmed === "quit" || trimmed === ":q") {
            ctx.exit()
            return
        }
        const selectedModel = ctx.local.model.current()
        if (!selectedModel) {
            ctx.toast?.show({
                variant: "warning",
                message: "Connect a provider to send prompts",
                duration: 3000,
            })
            return
        }
        const sessionID = ctx.props.sessionID
            ? ctx.props.sessionID
            : await (async () => {
                const sessionID = await ctx.sdk.client.session.create({}).then((x: any) => x.data!.id)
                return sessionID
            })()
        const messageID = Identifier.ascending("message")
        let inputText = ctx.store.prompt.input

        // Expand pasted text inline before submitting
        const allExtmarks = ctx.input.extmarks.getAllForTypeId(ctx.promptPartTypeId)
        const sortedExtmarks = allExtmarks.sort((a: { start: number }, b: { start: number }) => b.start - a.start)

        for (const extmark of sortedExtmarks) {
            const partIndex = ctx.store.extmarkToPartIndex.get(extmark.id)
            if (partIndex !== undefined) {
                const part = ctx.store.prompt.parts[partIndex]
                if (part?.type === "text" && part.text) {
                    const before = inputText.slice(0, extmark.start)
                    const after = inputText.slice(extmark.end)
                    inputText = before + part.text + after
                }
            }
        }

        // Filter out text parts (pasted content) since they're now expanded inline
        const nonTextParts = ctx.store.prompt.parts.filter((part: any) => part.type !== "text")

        // Capture mode before it gets reset
        const currentMode = ctx.store.mode
        const variant = ctx.local.model.variant.current()

        if (ctx.store.mode === "shell") {
            ctx.sdk.client.session.shell({
                sessionID,
                agent: ctx.local.agent.current().name,
                model: {
                    providerID: selectedModel.providerID,
                    modelID: selectedModel.modelID,
                },
                command: inputText,
            })
            ctx.setStore("mode", "normal")
        } else if (
            inputText.startsWith("/") &&
            iife(() => {
                const command = inputText.split(" ")[0].slice(1)
                return ctx.sync.data.command.some((x: any) => x.name === command)
            })
        ) {
            let [command, ...args] = inputText.split(" ")
            ctx.sdk.client.session.command({
                sessionID,
                command: command.slice(1),
                arguments: args.join(" "),
                agent: ctx.local.agent.current().name,
                model: `${selectedModel.providerID}/${selectedModel.modelID}`,
                messageID,
                variant,
                parts: nonTextParts
                    .filter((x: any) => x.type === "file")
                    .map((x: any) => ({
                        id: Identifier.ascending("part"),
                        ...x,
                    })),
            })
        } else {
            ctx.sdk.client.session.prompt({
                sessionID,
                ...selectedModel,
                messageID,
                agent: ctx.local.agent.current().name,
                model: selectedModel,
                variant,
                parts: [
                    {
                        id: Identifier.ascending("part"),
                        type: "text",
                        text: inputText,
                    },
                    ...nonTextParts.map((x: any) => ({
                        id: Identifier.ascending("part"),
                        ...x,
                    })),
                ],
            })
        }
        ctx.history.append({
            ...ctx.store.prompt,
            mode: currentMode,
        })
        ctx.input.extmarks.clear()
        ctx.setStore("prompt", {
            input: "",
            parts: [],
        })
        ctx.setStore("extmarkToPartIndex", new Map())
        ctx.props.onSubmit?.()

        // temporary hack to make sure the message is sent
        if (!ctx.props.sessionID)
            setTimeout(() => {
                ctx.route.navigate({
                    type: "session",
                    sessionID,
                })
            }, 50)
        ctx.input.clear()
    }

    function pasteText(text: string, virtualText: string) {
        const currentOffset = ctx.input.visualCursor.offset
        const extmarkStart = currentOffset
        const extmarkEnd = extmarkStart + virtualText.length

        ctx.input.insertText(virtualText + " ")

        const extmarkId = ctx.input.extmarks.create({
            start: extmarkStart,
            end: extmarkEnd,
            virtual: true,
            styleId: ctx.pasteStyleId,
            typeId: ctx.promptPartTypeId,
        })

        ctx.setStore(
            produce((draft: any) => {
                const partIndex = draft.prompt.parts.length
                draft.prompt.parts.push({
                    type: "text" as const,
                    text,
                    source: {
                        text: {
                            start: extmarkStart,
                            end: extmarkEnd,
                            value: virtualText,
                        },
                    },
                })
                draft.extmarkToPartIndex.set(extmarkId, partIndex)
            }),
        )
    }

    async function pasteImage(file: { filename?: string; content: string; mime: string }) {
        const currentOffset = ctx.input.visualCursor.offset
        const extmarkStart = currentOffset
        const count = ctx.store.prompt.parts.filter((x: any) => x.type === "file").length
        const virtualText = `[Image ${count + 1}]`
        const extmarkEnd = extmarkStart + virtualText.length
        const textToInsert = virtualText + " "

        ctx.input.insertText(textToInsert)

        const extmarkId = ctx.input.extmarks.create({
            start: extmarkStart,
            end: extmarkEnd,
            virtual: true,
            styleId: ctx.pasteStyleId,
            typeId: ctx.promptPartTypeId,
        })

        const part: Omit<FilePart, "id" | "messageID" | "sessionID"> = {
            type: "file" as const,
            mime: file.mime,
            filename: file.filename,
            url: `data:${file.mime};base64,${file.content}`,
            source: {
                type: "file",
                path: file.filename ?? "",
                text: {
                    start: extmarkStart,
                    end: extmarkEnd,
                    value: virtualText,
                },
            },
        }
        ctx.setStore(
            produce((draft: any) => {
                const partIndex = draft.prompt.parts.length
                draft.prompt.parts.push(part)
                draft.extmarkToPartIndex.set(extmarkId, partIndex)
            }),
        )
        return
    }

    return {
        submit,
        pasteText,
        pasteImage
    }
}
