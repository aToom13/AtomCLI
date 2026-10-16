import { expect, test } from "bun:test"
import "../../preload"
import type { TextareaRenderable } from "@opentui/core"
import type { PromptInfo } from "@/interfaces/cli/cmd/tui/component/prompt/history"
import { pasteImage, pasteText } from "@/interfaces/cli/cmd/tui/component/prompt/paste"

test("pasted parts keep extmarks and store updates under prompt ownership", async () => {
  const inserted: string[] = []
  const parts: PromptInfo["parts"] = []
  const extmarks = new Map<number, number>()
  const input = {
    visualCursor: { offset: 4 },
    insertText: (value: string) => inserted.push(value),
    extmarks: { create: () => 7 },
  } as unknown as TextareaRenderable
  const context = {
    input,
    pasteStyleId: 2,
    promptPartTypeId: 3,
    appendPart(part: PromptInfo["parts"][number], extmarkId: number) {
      extmarks.set(extmarkId, parts.push(part) - 1)
    },
    imageCount: () => parts.filter((part) => part.type === "file").length,
  }

  pasteText(context, "original text", "[Pasted text]")
  await pasteImage(context, { filename: "a.png", mime: "image/png", content: "ZmFrZQ==" })

  expect(inserted).toEqual(["[Pasted text] ", "[Image 1] "])
  expect(parts.map((part) => part.type)).toEqual(["text", "file"])
  expect(parts[0]).toMatchObject({ source: { text: { start: 4, end: 17, value: "[Pasted text]" } } })
  expect(parts[1]).toMatchObject({ filename: "a.png", url: "data:image/png;base64,ZmFrZQ==" })
  expect(extmarks.get(7)).toBe(1)
})
