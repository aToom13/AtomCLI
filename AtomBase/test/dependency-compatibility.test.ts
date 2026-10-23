import "./preload"
import { expect, test } from "bun:test"
import { createRequire } from "node:module"
import matter from "gray-matter"
import { ConfigMarkdown } from "@/core/config/markdown"

const require = createRequire(import.meta.url)

test("frontmatter round-trips agent metadata and rejects executable YAML", () => {
  const data = { description: "Security fixture", permission: { bash: "ask" }, tools: ["read", "grep"] }
  const document = matter.stringify("Agent instructions\n", data)
  const parsed = ConfigMarkdown.parseString(document)!
  expect(parsed.data).toEqual(data)
  expect(parsed.content).toBe("Agent instructions\n")
  expect(ConfigMarkdown.parseString("---\nvalue: !!js/function 'function () {}'\n---\nbody")).toBeUndefined()
})

test("OpenTUI's image decoder round-trips PNG pixels", async () => {
  const tui = createRequire(require.resolve("@opentui/core"))
  const { Jimp } = tui("jimp")
  const image = new Jimp({ width: 2, height: 2, color: 0x123456ff })
  const decoded = await Jimp.read(await image.getBuffer("image/png"))
  expect(decoded.bitmap.width).toBe(2)
  expect(decoded.bitmap.height).toBe(2)
  expect(decoded.getPixelColor(0, 0)).toBe(0x123456ff)
})

test("Google auth's HTTP client builds multipart requests with its UUID dependency", async () => {
  const vertex = createRequire(require.resolve("@ai-sdk/google-vertex"))
  const auth = createRequire(vertex.resolve("google-auth-library"))
  const { Gaxios } = auth("gaxios")
  let body = ""
  let contentType = ""
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      body = await request.text()
      contentType = request.headers.get("content-type") ?? ""
      return Response.json({ ok: true })
    },
  })
  try {
    const response = await new Gaxios().request({
      url: server.url.href,
      method: "POST",
      multipart: [{ headers: { "Content-Type": "text/plain" }, content: "fake-upload" }],
      timeout: 2000,
    })
    expect(response.data).toEqual({ ok: true })
    expect(contentType).toStartWith("multipart/related; boundary=")
    expect(body).toContain("fake-upload")
    expect(body).toContain(contentType.split("boundary=")[1])
  } finally {
    server.stop(true)
  }
})

test("GitHub Actions' HTTP client accepts the patched HTTP transport", async () => {
  const actions = createRequire(require.resolve("@actions/core"))
  const { HttpClient } = actions("@actions/http-client")
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("fixture-response") })
  const client = new HttpClient("atomcli-security-fixture")
  try {
    const response = await client.get(server.url.href)
    expect(response.message.statusCode).toBe(200)
    expect(await response.readBody()).toBe("fixture-response")
  } finally {
    client.dispose()
    server.stop(true)
  }
})
