import "../preload"
import { afterEach, expect, test } from "bun:test"
import { McpOAuthCallback } from "@/integrations/mcp/oauth-callback"
import { OAUTH_CALLBACK_PATH, OAUTH_CALLBACK_PORT } from "@/integrations/mcp/oauth-provider"

afterEach(async () => {
  await McpOAuthCallback.stop()
})

test("OAuth callback escapes provider error text and consumes an already registered state", async () => {
  await McpOAuthCallback.ensureRunning()
  const state = crypto.randomUUID()
  const callback = McpOAuthCallback.waitForCallback(state)
  const url = new URL(`http://127.0.0.1:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`)
  url.searchParams.set("code", "authorized")
  url.searchParams.set("state", state)
  const success = await fetch(url)
  expect(success.status).toBe(200)
  expect(await callback).toBe("authorized")

  const errorUrl = new URL(`http://127.0.0.1:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`)
  errorUrl.searchParams.set("state", "unknown")
  errorUrl.searchParams.set("error", "access_denied")
  errorUrl.searchParams.set("error_description", '<script>alert("x")</script>')
  const body = await (await fetch(errorUrl)).text()
  expect(body).not.toContain('<script>alert("x")</script>')
  expect(body).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;")
})
