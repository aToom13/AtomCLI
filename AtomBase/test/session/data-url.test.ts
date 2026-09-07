import { describe, expect, test } from "bun:test"
import "../preload"
import { DataUrl } from "@/core/session/data-url"

describe("session text data URL", () => {
  test("decodes only the base64 payload", () => {
    expect(DataUrl.decodeText("data:text/plain;base64,SGVsbG8=")).toBe("Hello")
  })

  test("decodes percent-encoded UTF-8 text", () => {
    expect(DataUrl.decodeText("data:text/plain;charset=utf-8,Merhaba%20d%C3%BCnya")).toBe("Merhaba dünya")
  })

  test("rejects malformed base64 and invalid UTF-8", () => {
    expect(() => DataUrl.decodeText("data:text/plain;base64,%%%=")).toThrow("invalid base64")
    expect(() => DataUrl.decodeText("data:text/plain;base64,/w==")).toThrow("valid UTF-8")
  })

  test("rejects decoded text over one MiB", () => {
    const payload = Buffer.alloc(1024 * 1024 + 1, 65).toString("base64")
    expect(() => DataUrl.decodeText(`data:text/plain;base64,${payload}`)).toThrow("byte limit")
  })
})
