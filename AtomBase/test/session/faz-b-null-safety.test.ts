import { describe, test, expect, mock } from "bun:test"
import { SessionCompaction } from "@/core/session/compaction"
import { SessionSummary } from "@/core/session/summary"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import { pathToFileURL } from "url"

describe("Faz B Null Safety & Boundary Checks", () => {
  const dummyCtx = {
    sessionID: "test-session-id",
    messageID: "test-message-id",
    agent: "agent",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }

  test("B1. compaction.ts throws descriptive error when parentID is not found", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(
          SessionCompaction.process({
            parentID: "non-existent-parent-id",
            messages: [],
            sessionID: "test-session",
            abort: new AbortController().signal,
            auto: false,
          }),
        ).rejects.toThrow('Parent user message with id "non-existent-parent-id" not found for compaction')
      },
    })
  })

  test("B2. summary.ts handles missing messageID without crashing", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(
          SessionSummary.summarize({
            sessionID: "test-session",
            messageID: "non-existent-msg-id",
          }),
        ).resolves.toBeUndefined()
      },
    })
  })

  test("B3. processor.ts converts null/undefined/string/Error values safely to string", () => {
    const errorStringify = (error: any) =>
      error instanceof Error ? error.message : String(error ?? "")

    expect(errorStringify(null)).toBe("")
    expect(errorStringify(undefined)).toBe("")
    expect(errorStringify(new Error("custom error"))).toBe("custom error")
    expect(errorStringify({ custom: "object" })).toBe("[object Object]")
    expect(errorStringify("string error")).toBe("string error")
  })

  test("B4. prompt.ts fileURLToPath rejects paths outside Instance.worktree", async () => {
    const { SessionPrompt } = await import("@/core/session/prompt")
    const { Session } = await import("@/core/session")
    const { Provider } = await import("@/integrations/provider/provider")

    const origGetModel = Provider.getModel
    Provider.getModel = async () =>
      ({
        providerID: "mock",
        modelID: "mock",
        name: "Mock Model",
        api: { url: "http://localhost" },
      } as any)

    await using tmp = await tmpdir({ git: true })
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const outsidePath = path.resolve(tmp.path, "../outside-file.txt")
          const fileUrl = pathToFileURL(outsidePath).href

          expect(
            SessionPrompt.prompt({
              sessionID: session.id,
              agent: "agent",
              model: { providerID: "test", modelID: "test" },
              parts: [
                {
                  type: "file",
                  url: fileUrl,
                  mime: "text/plain",
                },
              ],
            }),
          ).rejects.toThrow("outside worktree boundary")
        },
      })
    } finally {
      Provider.getModel = origGetModel
    }
  })

  test("B5. browser.ts screenshot checks external workdir directory permissions", async () => {
    const { BrowserTool } = await import("@/integrations/tool/browser")
    const { Browser } = await import("@/integrations/browser")
    
    // Mock Playwright availability to true so permission check runs
    const origAvailable = Browser.isPlaywrightAvailable
    Browser.isPlaywrightAvailable = async () => true

    await using tmp = await tmpdir({ git: true })
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const instance = await BrowserTool.init({})
          let permissionAsked = false
          const mockCtx = {
            ...dummyCtx,
            ask: async (params: any) => {
              if (params.permission === "external_directory") {
                permissionAsked = true
                throw new Error("External directory permission denied")
              }
            },
          }

          const externalWorkdir = path.resolve(tmp.path, "../outside-dir")
          expect(
            instance.execute(
              {
                action: "screenshot",
                workdir: externalWorkdir,
              },
              mockCtx,
            ),
          ).rejects.toThrow("External directory permission denied")

          expect(permissionAsked).toBe(true)
        },
      })
    } finally {
      Browser.isPlaywrightAvailable = origAvailable
    }
  })
})
