import { TextareaRenderable } from "@opentui/core"
import { PromptInfo } from "./history"
import { produce } from "solid-js/store"

export function restoreExtmarksFromParts(
    input: TextareaRenderable,
    parts: PromptInfo["parts"],
    setStore: any, // Typed as Store setter
    fileStyleId: number,
    agentStyleId: number,
    pasteStyleId: number,
    promptPartTypeId: number
) {
    input.extmarks.clear()
    setStore("extmarkToPartIndex", new Map())

    parts.forEach((part, partIndex) => {
        let start = 0
        let end = 0
        let virtualText = ""
        let styleId: number | undefined

        if (part.type === "file" && part.source?.text) {
            start = part.source.text.start
            end = part.source.text.end
            virtualText = part.source.text.value
            styleId = fileStyleId
        } else if (part.type === "agent" && part.source) {
            start = part.source.start
            end = part.source.end
            virtualText = part.source.value
            styleId = agentStyleId
        } else if (part.type === "text" && part.source?.text) {
            start = part.source.text.start
            end = part.source.text.end
            virtualText = part.source.text.value
            styleId = pasteStyleId
        }

        if (virtualText) {
            const extmarkId = input.extmarks.create({
                start,
                end,
                virtual: true,
                styleId,
                typeId: promptPartTypeId,
            })
            setStore("extmarkToPartIndex", (map: Map<number, number>) => {
                const newMap = new Map(map)
                newMap.set(extmarkId, partIndex)
                return newMap
            })
        }
    })
}

export function syncExtmarksWithPromptParts(
    input: TextareaRenderable,
    setStore: any,
    promptPartTypeId: number
) {
    const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
    setStore(
        produce((draft: any) => {
            const newMap = new Map<number, number>()
            const newParts: any[] = []

            for (const extmark of allExtmarks) {
                const partIndex = draft.extmarkToPartIndex.get(extmark.id)
                if (partIndex !== undefined) {
                    const part = draft.prompt.parts[partIndex]
                    if (part) {
                        if (part.type === "agent" && part.source) {
                            part.source.start = extmark.start
                            part.source.end = extmark.end
                        } else if (part.type === "file" && part.source?.text) {
                            part.source.text.start = extmark.start
                            part.source.text.end = extmark.end
                        } else if (part.type === "text" && part.source?.text) {
                            part.source.text.start = extmark.start
                            part.source.text.end = extmark.end
                        }
                        newMap.set(extmark.id, newParts.length)
                        newParts.push(part)
                    }
                }
            }

            draft.extmarkToPartIndex = newMap
            draft.prompt.parts = newParts
        }),
    )
}
