import type { FilePart } from "@atomcli/sdk/v2"
import type { PasteEvent, TextareaRenderable } from "@opentui/core"
import type { PromptInfo } from "./history"

type PasteContext = {
  input: TextareaRenderable
  pasteStyleId: number
  promptPartTypeId: number
  appendPart(part: PromptInfo["parts"][number], extmarkId: number): void
  imageCount(): number
}

export function pasteText(ctx: PasteContext, text: string, virtualText: string) {
  const { input, pasteStyleId, promptPartTypeId } = ctx
  const currentOffset = input.visualCursor.offset
  const extmarkStart = currentOffset
  const extmarkEnd = extmarkStart + virtualText.length

  input.insertText(virtualText + " ")

  const extmarkId = input.extmarks.create({
    start: extmarkStart,
    end: extmarkEnd,
    virtual: true,
    styleId: pasteStyleId,
    typeId: promptPartTypeId,
  })

  ctx.appendPart(
    {
      type: "text",
      text,
      source: { text: { start: extmarkStart, end: extmarkEnd, value: virtualText } },
    },
    extmarkId,
  )
}

export async function pasteImage(ctx: PasteContext, file: { filename?: string; content: string; mime: string }) {
  const { input, pasteStyleId, promptPartTypeId } = ctx
  const currentOffset = input.visualCursor.offset
  const extmarkStart = currentOffset
  const count = ctx.imageCount()
  const virtualText = `[Image ${count + 1}]`
  const extmarkEnd = extmarkStart + virtualText.length
  const textToInsert = virtualText + " "

  input.insertText(textToInsert)

  const extmarkId = input.extmarks.create({
    start: extmarkStart,
    end: extmarkEnd,
    virtual: true,
    styleId: pasteStyleId,
    typeId: promptPartTypeId,
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
  ctx.appendPart(part, extmarkId)
}

export async function handlePromptPaste(
  event: PasteEvent,
  ctx: {
    disabled: boolean
    disablePasteSummary: boolean | undefined
    input: TextareaRenderable
    renderer: { requestRender(): void }
    triggerPaste(): void
    pasteText(text: string, virtualText: string): void
    pasteImage(file: { filename?: string; content: string; mime: string }): Promise<void>
  },
) {
  const { disabled, disablePasteSummary, input, renderer, triggerPaste, pasteText, pasteImage } = ctx
  if (disabled) {
    event.preventDefault()
    return
  }

  // Normalize line endings at the boundary
  // Windows ConPTY/Terminal often sends CR-only newlines in bracketed paste
  // Replace CRLF first, then any remaining CR
  const normalizedText = event.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const pastedContent = normalizedText.trim()
  if (!pastedContent) {
    triggerPaste()
    return
  }

  // trim ' from the beginning and end of the pasted content. just
  // ' and nothing else
  const filepath = pastedContent.replace(/^'+|'+$/g, "").replace(/\\ /g, " ")
  const isUrl = /^(https?):\/\//.test(filepath)
  if (!isUrl) {
    try {
      const file = Bun.file(filepath)
      // Handle SVG as raw text content, not as base64 image
      if (file.type === "image/svg+xml") {
        event.preventDefault()
        const content = await file.text().catch(() => {})
        if (content) {
          pasteText(content, `[SVG: ${file.name ?? "image"}]`)
          return
        }
      }
      if (file.type.startsWith("image/")) {
        event.preventDefault()
        const content = await file
          .arrayBuffer()
          .then((buffer) => Buffer.from(buffer).toString("base64"))
          .catch(() => {})
        if (content) {
          await pasteImage({
            filename: file.name,
            mime: file.type,
            content,
          })
          return
        }
      }
    } catch {}
  }

  const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
  if ((lineCount > 50 || pastedContent.length > 3000) && !disablePasteSummary) {
    event.preventDefault()
    pasteText(pastedContent, `[Pasted ~${lineCount} lines]`)
    return
  }

  // Force layout update and render for the pasted content
  setTimeout(() => {
    input.getLayoutNode().markDirty()
    input.gotoBufferEnd()
    renderer.requestRender()
  }, 0)
}
