import "../preload"
import { expect, mock, test } from "bun:test"
import { fetchToken } from "@modelcontextprotocol/sdk/client/auth.js"
import { McpAuth } from "@/integrations/mcp/auth"
import { McpOAuthProvider } from "@/integrations/mcp/oauth-provider"

for (const configured of [false, true]) {
  test(`OAuth credentials retain their authorization server across reloads: configured=${configured}`, async () => {
    const name = `fake-oauth-${crypto.randomUUID()}`
    const server = "https://fake-mcp.invalid/mcp"
    const issuer = "https://fake-issuer.invalid/"
    const info = { client_id: "fake-client", client_secret: "fake-secret", issuer, redirect_uris: [] }
    const config = configured ? { clientId: info.client_id, clientSecret: info.client_secret } : {}
    const create = () => new McpOAuthProvider(name, server, config, { onRedirect() {} })
    try {
      await create().saveClientInformation(info)
      await create().saveTokens({
        access_token: "fake-access",
        refresh_token: "fake-refresh",
        token_type: "Bearer",
        issuer,
      })
      await create().saveCodeVerifier("fake-code-verifier")
      expect((await create().clientInformation())?.issuer).toBe(issuer)
      expect((await create().tokens())?.issuer).toBe(issuer)
      const transport = mock(async () => Response.json({ access_token: "fake-new-access", token_type: "Bearer" }))
      await expect(
        fetchToken(create(), new URL("https://other-issuer.invalid/"), {
          authorizationCode: "fake-code",
          fetchFn: transport,
        }),
      ).rejects.toThrow("bound to authorization server")
      expect(transport).not.toHaveBeenCalled()
      expect(
        await fetchToken(create(), new URL(issuer), { authorizationCode: "fake-code", fetchFn: transport }),
      ).toMatchObject({ access_token: "fake-new-access" })
      expect(transport).toHaveBeenCalledTimes(1)
    } finally {
      await McpAuth.remove(name)
    }
  })
}

test("dynamic registration cannot replace configured OAuth credentials", async () => {
  const name = `fake-oauth-${crypto.randomUUID()}`
  const provider = new McpOAuthProvider(
    name,
    "https://fake-mcp.invalid/mcp",
    { clientId: "fake-configured-client", clientSecret: "fake-configured-secret" },
    { onRedirect() {} },
  )
  try {
    await expect(
      provider.saveClientInformation({
        client_id: "fake-replacement",
        issuer: "https://other-issuer.invalid/",
        redirect_uris: [],
      }),
    ).rejects.toThrow("configured MCP OAuth client")
    expect(await McpAuth.get(name)).toBeUndefined()
  } finally {
    await McpAuth.remove(name)
  }
})
