import { describe, expect, test } from "bun:test"
import "../preload"
import path from "path"
import { SessionCompaction } from "@/core/session/compaction"
import { Token } from "@/util/util/token"
import { Instance } from "@/services/project/instance"
import { Log } from "@/util/util/log"
import { tmpdir } from "../fixture/fixture"
import { Session } from "@/core/session"
import type { Provider } from "@/integrations/provider/provider"
import { Skill } from "@/integrations/skill"

test("compaction retains skill sources, partial ranges, and deferred paths without retaining bodies", () => {
  const context = [
    "Skill: route-test; source: /skills/route-test/SKILL.md",
    "Loaded parent route-test: characters 0–12 of 40",
    "Private instruction body is not a manifest",
    "### route-test/references/play.md (characters 0–50 of 800; source: /skills/route-test/references/play.md)",
    "- route-test/references/play.md, offset=50: partial; context limit",
  ].join("\n")
  const manifest = SessionCompaction._internals.skillManifest([
    {
      parts: [
        { type: "text", metadata: { skillManifest: Skill.loadingManifest(context) }, text: context },
        {
          type: "tool",
          tool: "skill",
          state: {
            status: "completed",
            metadata: {
              name: "route-test",
              location: "/skills/route-test/references/play.md",
              reference: "route-test/references/play.md",
              offset: 50,
              length: 100,
              totalChars: 800,
              loadedReferences: [],
              remainingReferences: [],
            },
          },
        },
      ],
    },
  ] as never)
  expect(manifest).toContain("source: /skills/route-test/SKILL.md")
  expect(manifest).toContain("characters 0–12 of 40")
  expect(manifest).toContain("characters 50–150 of 800")
  expect(manifest).toContain("offset=150")
  expect(manifest).toContain("offset=50")
  expect(manifest).not.toContain("Private instruction body")
  const retained = SessionCompaction._internals.skillManifest([
    { parts: [{ type: "text", metadata: { skillManifest: manifest }, text: "summary" }] },
  ] as never)
  expect(retained).toBe(manifest)
  const oversized = Array.from(
    { length: 1_000 },
    (_, index) => `- route-test/references/step-${index}.md, offset=${index}: partial; context limit`,
  ).join("\n")
  const bounded = SessionCompaction._internals.skillManifest([
    { parts: [{ type: "text", metadata: { skillManifest: oversized } }] },
  ] as never)
  expect(bounded).toContain("step-999.md, offset=999")
  expect(bounded).not.toContain("step-0.md, offset=0")
  expect(bounded).toContain("Loading history shortened")
  expect(bounded.length).toBeLessThan(12_100)
})

Log.init({ print: false })

function createModel(opts: { context: number; output: number; cost?: Provider.Model["cost"] }): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: {
      context: opts.context,
      output: opts.output,
    },
    cost: opts.cost ?? { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

describe("session.compaction.isOverflow", () => {
  test("returns true when token count exceeds usable context", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 32_000 })
        const tokens = { input: 85_000, output: 5_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })

  test("returns false when token count within usable context", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 200_000, output: 32_000 })
        const tokens = { input: 100_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })

  test("keeps 80k of a 100k context without reserving the native generation ceiling", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 384_000 })
        const tokens = { input: 75_000, output: 5_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })

  test("includes cache.read in token count", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 32_000 })
        const tokens = { input: 65_000, output: 10_000, reasoning: 0, cache: { read: 10_000, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
      },
    })
  })

  test("returns false when model context limit is 0", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 0, output: 32_000 })
        const tokens = { input: 100_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })

  test("returns false when compaction.auto is disabled", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "atomcli.json"),
          JSON.stringify({
            compaction: { auto: false },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = createModel({ context: 100_000, output: 32_000 })
        const tokens = { input: 75_000, output: 5_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(false)
      },
    })
  })
})

describe("session.compaction summary acceptance", () => {
  test("rejects empty and whitespace-only summaries", () => {
    expect(
      SessionCompaction._internals.isAcceptableSummary({ sourceTokens: 100, summaryTokens: 0, summaryText: "" }),
    ).toBe(false)
    expect(
      SessionCompaction._internals.isAcceptableSummary({ sourceTokens: 100, summaryTokens: 1, summaryText: "  \n" }),
    ).toBe(false)
  })

  const structuredSummary = [
    "## Completed work",
    "Implemented the login flow and wired the session store.",
    "",
    "## Remaining work",
    "Add refresh token rotation and cover it with tests.",
    "",
    "## Files",
    "src/auth/login.ts, src/core/session/index.ts",
    "",
    "## Verification",
    "bun test test/session/ passes.",
    "",
    "## Blockers",
    "none",
  ].join("\n")

  test("rejects short prose-only junk summaries", () => {
    expect(
      SessionCompaction._internals.isAcceptableSummary({
        sourceTokens: 100,
        summaryTokens: 20,
        summaryText: "Useful continuation context",
      }),
    ).toBe(false)
  })

  test("accepts a summary with at least the minimum number of structural sections", () => {
    expect(
      SessionCompaction._internals.isAcceptableSummary({
        sourceTokens: 1000,
        summaryTokens: 60,
        summaryText: structuredSummary,
      }),
    ).toBe(true)
    const partial = ["## Completed work", "Done.", "", "## Blockers", "none"].join("\n")
    expect(
      SessionCompaction._internals.isAcceptableSummary({
        sourceTokens: 1000,
        summaryTokens: 10,
        summaryText: partial,
      }),
    ).toBe(false)
  })

  test("accepts long-form prose summaries above the content floor", () => {
    const prose =
      "We refactored the session pipeline so compaction now writes a durable transaction record before the summary message. The remaining work is to cover the crash recovery path with an integration test and to audit filterCompacted for legacy summaries that predate the transaction log."
    expect(prose.length).toBeGreaterThanOrEqual(SessionCompaction.SUMMARY_MIN_PROSE_LENGTH)
    expect(SessionCompaction._internals.countSummarySections(prose)).toBe(0)
    expect(
      SessionCompaction._internals.isAcceptableSummary({
        sourceTokens: 1000,
        summaryTokens: 80,
        summaryText: prose,
      }),
    ).toBe(true)
  })

  test("requires a summary smaller than the source", () => {
    expect(
      SessionCompaction._internals.isAcceptableSummary({
        sourceTokens: 20,
        summaryTokens: 20,
        summaryText: structuredSummary,
      }),
    ).toBe(false)
    expect(
      SessionCompaction._internals.isAcceptableSummary({
        sourceTokens: 0,
        summaryTokens: 20,
        summaryText: structuredSummary,
      }),
    ).toBe(true)
  })
})

describe("util.token.estimate", () => {
  test("estimates tokens from text (3 chars per token)", () => {
    const text = "x".repeat(4000)
    expect(Token.estimate(text)).toBe(1333)
  })

  test("estimates tokens from larger text", () => {
    const text = "y".repeat(20_000)
    expect(Token.estimate(text)).toBe(6667)
  })

  test("returns 0 for empty string", () => {
    expect(Token.estimate("")).toBe(0)
  })
})

describe("session.getUsage", () => {
  test("normalizes standard usage to token format", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      },
    })

    expect(result.tokens.input).toBe(1000)
    expect(result.tokens.output).toBe(500)
    expect(result.tokens.reasoning).toBe(0)
    expect(result.tokens.cache.read).toBe(0)
    expect(result.tokens.cache.write).toBe(0)
  })

  test("extracts cached tokens to cache.read", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokens: 200,
      },
    })

    expect(result.tokens.input).toBe(800)
    expect(result.tokens.cache.read).toBe(200)
  })

  test("handles anthropic cache write metadata", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      },
      metadata: {
        anthropic: {
          cacheCreationInputTokens: 300,
        },
      },
    })

    expect(result.tokens.cache.write).toBe(300)
  })

  test("does not subtract cached tokens for anthropic provider", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cachedInputTokens: 200,
      },
      metadata: {
        anthropic: {},
      },
    })

    expect(result.tokens.input).toBe(1000)
    expect(result.tokens.cache.read).toBe(200)
  })

  test("handles reasoning tokens", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        reasoningTokens: 100,
      },
    })

    expect(result.tokens.reasoning).toBe(100)
  })

  test("handles undefined optional values gracefully", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    })

    expect(result.tokens.input).toBe(0)
    expect(result.tokens.output).toBe(0)
    expect(result.tokens.reasoning).toBe(0)
    expect(result.tokens.cache.read).toBe(0)
    expect(result.tokens.cache.write).toBe(0)
    expect(Number.isNaN(result.cost)).toBe(false)
  })

  test("calculates cost correctly", () => {
    const model = createModel({
      context: 100_000,
      output: 32_000,
      cost: {
        input: 3,
        output: 15,
        cache: { read: 0.3, write: 3.75 },
      },
    })
    const result = Session.getUsage({
      model,
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        totalTokens: 1_100_000,
      },
    })

    expect(result.cost).toBe(3 + 1.5)
  })
})
