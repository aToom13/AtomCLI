import "../preload"
import { expect, test } from "bun:test"
import { MessageV2 } from "@/core/session/message-v2"

const sessionID = "session"

function userInfo(id: string): MessageV2.User {
  return {
    id,
    sessionID,
    role: "user",
    time: { created: 0 },
    agent: "user",
    model: { providerID: "openai", modelID: "gpt-5" },
  } as MessageV2.User
}

function assistantInfo(id: string, parentID: string, providerID: string): MessageV2.Assistant {
  return {
    id,
    sessionID,
    role: "assistant",
    time: { created: 1 },
    parentID,
    modelID: "gateway-model",
    providerID,
    agent: "agent",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as MessageV2.Assistant
}

function basePart(messageID: string, id: string) {
  return { id, sessionID, messageID }
}

test("does not replay an OpenAI-shaped Responses item ID created by another provider", async () => {
  const foreignReasoningID = "rs_6aa103abb1c40d7506c04ee3:rs_01a084f654ce7f7387009d26c1bf9eb3"
  const userID = "msg-user"
  const assistantID = "msg-assistant"
  const history: MessageV2.WithParts[] = [
    {
      info: userInfo(userID),
      parts: [{ ...basePart(userID, "part-user"), type: "text", text: "hello" }],
    },
    {
      info: assistantInfo(assistantID, userID, "atomcli"),
      parts: [
        {
          ...basePart(assistantID, "part-reasoning"),
          type: "reasoning",
          text: "",
          time: { start: 0, end: 1 },
          metadata: {
            openai: {
              itemId: foreignReasoningID,
              reasoningEncryptedContent: "foreign-encrypted-content",
            },
          },
        },
        {
          ...basePart(assistantID, "part-text"),
          type: "text",
          text: "hi",
          metadata: { openai: { itemId: "msg_foreign" } },
        },
      ],
    },
  ] as MessageV2.WithParts[]

  const messages = await MessageV2.toModelMessage(history, "openai")
  expect(JSON.stringify(messages)).not.toContain(foreignReasoningID)
  expect((history[1].parts[0] as MessageV2.ReasoningPart).metadata?.openai.itemId).toBe(foreignReasoningID)

  let requestBody: any
  const { createOpenAI } = await import("@ai-sdk/openai")
  const provider = createOpenAI({
    apiKey: "fake-openai-key",
    fetch: (async (_url, init) => {
      requestBody = JSON.parse(init?.body as string)
      return new Response(
        JSON.stringify({ error: { message: "stop after capture", type: "fixture", code: "fixture" } }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      )
    }) as typeof fetch,
  })

  await expect(
    provider.responses("gpt-5").doGenerate({
      prompt: messages,
      providerOptions: { openai: { store: false } },
    } as any),
  ).rejects.toThrow()

  expect(requestBody.input).toEqual([
    { role: "user", content: [{ type: "input_text", text: "hello" }] },
    { role: "assistant", content: [{ type: "output_text", text: "hi" }] },
  ])
  expect(JSON.stringify(requestBody.input)).not.toContain(foreignReasoningID)
})

test("keeps Responses item metadata when the producing and target providers match", async () => {
  const reasoningID = "rs_01a084f654ce7f7387009d26c1bf9eb3"
  const assistantID = "msg-assistant"
  const history: MessageV2.WithParts[] = [
    {
      info: assistantInfo(assistantID, "msg-user", "openai"),
      parts: [
        {
          ...basePart(assistantID, "part-reasoning"),
          type: "reasoning",
          text: "thinking",
          time: { start: 0, end: 1 },
          metadata: MessageV2.withProviderMetadataSource(
            { openai: { itemId: reasoningID, reasoningEncryptedContent: "encrypted" } },
            "openai",
          ),
        },
      ],
    },
  ] as MessageV2.WithParts[]

  const messages = JSON.stringify(await MessageV2.toModelMessage(history, "openai"))
  expect(messages).toContain(reasoningID)
  expect(messages).not.toContain("atomcliProviderID")
})

test("uses part provenance when a fallback updated the assistant provider", async () => {
  const foreignReasoningID = "rs_gateway:rs_upstream"
  const assistantID = "msg-assistant"
  const history: MessageV2.WithParts[] = [
    {
      info: assistantInfo(assistantID, "msg-user", "openai"),
      parts: [
        {
          ...basePart(assistantID, "part-reasoning"),
          type: "reasoning",
          text: "thinking",
          time: { start: 0, end: 1 },
          metadata: MessageV2.withProviderMetadataSource(
            { openai: { itemId: foreignReasoningID, reasoningEncryptedContent: "foreign-encrypted-content" } },
            "atomcli",
          ),
        },
      ],
    },
  ] as MessageV2.WithParts[]

  const messages = JSON.stringify(await MessageV2.toModelMessage(history, "openai"))
  expect(messages).not.toContain(foreignReasoningID)
  expect(messages).not.toContain("atomcliProviderID")
})
