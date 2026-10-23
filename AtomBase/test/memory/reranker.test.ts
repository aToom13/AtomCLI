import "../preload"
import { expect, spyOn, test } from "bun:test"
import { ModelPurpose } from "@/core/routing/model-purpose"
import { rerank } from "@/core/memory/core/reranker"

test("reranker aborts the actual model request at its deadline and retains BM25 order", async () => {
  let aborted = false
  let calls = 0
  const resolve = spyOn(ModelPurpose, "resolve").mockResolvedValue({
    model: {} as any,
    language: {
      specificationVersion: "v2",
      provider: "fixture",
      modelId: "fixture",
      supportedUrls: {},
      doGenerate: async ({ abortSignal }) => {
        calls++
        return new Promise((_, reject) => {
          abortSignal!.addEventListener(
            "abort",
            () => {
              aborted = true
              reject(abortSignal!.reason)
            },
            { once: true },
          )
        })
      },
      doStream: async () => {
        throw new Error("unexpected stream")
      },
    } as any,
  })
  try {
    const candidates = Array.from({ length: 4 }, (_, i) => ({ id: String(i), content: `Memory ${i}`, score: 4 - i }))
    expect((await rerank("fixture query", candidates, 2)).map((item) => item.id)).toEqual(["0", "1"])
    expect(aborted).toBe(true)
    expect(calls).toBe(1)
  } finally {
    resolve.mockRestore()
  }
}, 10_000)
