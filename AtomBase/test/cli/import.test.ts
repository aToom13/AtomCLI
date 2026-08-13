import { describe, expect, test } from "bun:test"
import { SessionImport } from "@/interfaces/cli/cmd/import"

describe("session import", () => {
  test("parses current and legacy share links", () => {
    expect(SessionImport.parseShareUrl("https://atomcli.ai/share/demo_123")).toEqual({
      id: "demo_123",
      origin: "https://atomcli.ai",
    })
    expect(SessionImport.parseShareUrl("https://opncd.ai/s/demo-123/")).toEqual({
      id: "demo-123",
      origin: "https://opncd.ai",
    })
    expect(SessionImport.parseShareUrl("https://atomcli.ai/not-share/demo")).toBeUndefined()
    expect(SessionImport.parseShareUrl("https://atomcli.ai/share/demo?token=secret")).toBeUndefined()
  })

  test("normalizes the flat share API response", () => {
    const result = SessionImport.normalize([
      { type: "part", data: { id: "part-1", messageID: "message-1" } },
      { type: "session", data: { id: "session-1" } },
      { type: "message", data: { id: "message-1" } },
    ])

    expect(result?.info.id).toBe("session-1")
    expect(result?.messages).toEqual([
      {
        info: { id: "message-1" },
        parts: [{ id: "part-1", messageID: "message-1" }],
      },
    ])
  })

  test("keeps exported JSON and supports legacy message maps", () => {
    const exported: any = {
      info: { id: "session-1" },
      messages: [{ info: { id: "message-1" }, parts: [] }],
    }
    expect(SessionImport.normalize(exported)).toEqual(exported)

    const legacy = SessionImport.normalize({
      info: { id: "session-1" },
      messages: {
        "message-1": { id: "message-1", parts: [{ id: "part-1" }] },
      },
    })
    expect(legacy as any).toEqual({
      info: { id: "session-1" },
      messages: [
        {
          info: { id: "message-1" },
          parts: [{ id: "part-1" }],
        },
      ],
    })
  })
})
