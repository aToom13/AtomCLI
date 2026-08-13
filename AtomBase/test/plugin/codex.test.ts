import { describe, expect, test } from "bun:test"
import {
  parseJwtClaims,
  extractAccountIdFromClaims,
  extractAccountId,
  CodexModels,
  CodexOAuth,
  type IdTokenClaims,
} from "@/integrations/plugin/codex"
import type { Provider } from "@/integrations/provider/provider"
import { createServer, type Server } from "net"

async function listenOnEphemeralPort() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Failed to reserve an ephemeral test port")
  return { server, port: address.port }
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}

async function findOpenPort() {
  const reservation = await listenOnEphemeralPort()
  await closeServer(reservation.server)
  return reservation.port
}

function createTestJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.sig`
}

describe("plugin.codex", () => {
  describe("CodexOAuth", () => {
    test("validates state before accepting a remote OAuth error", () => {
      const forged = CodexOAuth.validateCallback(
        new URL("http://localhost:1455/auth/callback?state=forged&error=access_denied&error_description=cancelled"),
        "expected",
      )
      expect(forged).toEqual({ type: "invalid", message: "Invalid state - potential CSRF attack" })
    })

    test("escapes remote error text before rendering HTML", () => {
      const page = CodexOAuth.errorPage('<script>alert("oauth")</script>')
      expect(page).not.toContain('<script>alert("oauth")</script>')
      expect(page).toContain("&lt;script&gt;alert(&quot;oauth&quot;)&lt;/script&gt;")
    })

    test("only resolves authenticated requests to the trusted Codex backend", () => {
      expect(CodexOAuth.resolveRequestUrl("https://api.openai.com/v1/responses").toString()).toBe(
        "https://chatgpt.com/backend-api/codex/responses",
      )
      expect(CodexOAuth.resolveRequestUrl("https://chatgpt.com/backend-api/codex/models").origin).toBe(
        "https://chatgpt.com",
      )
      expect(() => CodexOAuth.resolveRequestUrl("https://attacker.example/collect")).toThrow("untrusted URL")
      expect(() => CodexOAuth.resolveRequestUrl("https://chatgpt.com/backend-api/codex-impersonator")).toThrow(
        "untrusted URL",
      )
    })

    test("keeps a valid login alive after forged state, escapes errors, and closes the server", async () => {
      const flow = await CodexOAuth.beginAuthorization(await findOpenPort())
      const state = new URL(flow.url).searchParams.get("state")!
      const callbackUrl = new URL(new URL(flow.url).searchParams.get("redirect_uri")!)
      callbackUrl.hostname = "127.0.0.1"
      const callback = flow.callback().catch((error): Error => (error instanceof Error ? error : new Error(String(error))))

      callbackUrl.search = "?state=forged&error=access_denied"
      const forged = await fetch(callbackUrl)
      expect(forged.status).toBe(400)

      const malicious = '<script>alert("oauth")</script>'
      callbackUrl.search = new URLSearchParams({ state, error: "access_denied", error_description: malicious }).toString()
      const rejected = await fetch(callbackUrl)
      const page = await rejected.text()
      expect(rejected.status).toBe(400)
      expect(page).not.toContain(malicious)
      expect(page).toContain("&lt;script&gt;")
      const callbackResult = await callback
      if (!(callbackResult instanceof Error)) throw new Error("Expected OAuth callback rejection")
      expect(callbackResult.message).toBe(malicious)

      // The terminal error path must release the fixed callback port.
      const restarted = await CodexOAuth.startServer(await findOpenPort())
      expect(restarted.hostname).toBe("127.0.0.1")
      CodexOAuth.stopServer()
    })

    test("reports a callback port collision without retaining server state", async () => {
      const blocker = await listenOnEphemeralPort()
      try {
        await expect(CodexOAuth.startServer(blocker.port)).rejects.toThrow(`callback port ${blocker.port} is unavailable`)
      } finally {
        CodexOAuth.stopServer()
        await closeServer(blocker.server)
      }
    })
  })

  describe("CodexModels.apply", () => {
    test("replaces stale models with the account-specific remote catalog", () => {
      const models = {
        "gpt-5.2": {
          id: "gpt-5.2",
          providerID: "openai",
          api: { id: "gpt-5.2", npm: "@ai-sdk/openai", url: "https://api.openai.com/v1" },
          name: "GPT-5.2",
          family: "gpt-5",
          capabilities: {
            temperature: false,
            reasoning: true,
            attachment: true,
            toolcall: true,
            input: { text: true, audio: false, image: true, video: false, pdf: false },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
          },
          cost: { input: 1, output: 2, cache: { read: 0, write: 0 } },
          limit: { context: 400000, output: 128000 },
          status: "active",
          options: {},
          headers: {},
          release_date: "2025-12-11",
          variants: {},
        },
      } as Provider.Info["models"]

      const count = CodexModels.apply(models, {
        models: [
          {
            slug: "gpt-5.6-sol",
            display_name: "GPT-5.6 Sol",
            supported_in_api: true,
            visibility: "list",
            context_window: 512000,
            supported_reasoning_levels: ["low", { effort: "xhigh" }, { effort: "max" }],
            input_modalities: ["text", "image"],
          },
        ],
      })

      expect(count).toBe(1)
      expect(models["gpt-5.2"]).toBeUndefined()
      expect(models["gpt-5.6-sol"]?.name).toBe("GPT-5.6 Sol")
      expect(models["gpt-5.6-sol"]?.limit.context).toBe(512000)
      expect(models["gpt-5.6-sol"]?.variants.max).toEqual({
        reasoningEffort: "max",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      })
      expect(models["gpt-5.6-sol"]?.cost.input).toBe(0)
    })

    test("uses picker visibility and does not apply the API-key filter in ChatGPT mode", () => {
      const models = {} as Provider.Info["models"]
      const count = CodexModels.apply(models, {
        models: [
          { slug: "visible", visibility: "list", supported_in_api: true },
          { slug: "hidden", visibility: "hide", supported_in_api: true },
          { slug: "unsupported", visibility: "list", supported_in_api: false },
        ],
      })

      expect(count).toBe(2)
      expect(Object.keys(models)).toEqual(["visible", "unsupported"])
    })

    test("rejects malformed catalogs without mutating the current models", () => {
      const models = { current: { id: "current" } } as unknown as Provider.Info["models"]

      expect(() => CodexModels.apply(models, {})).toThrow("missing models")
      expect(Object.keys(models)).toEqual(["current"])
      expect(() =>
        CodexModels.apply(models, {
          models: [{ slug: "broken", visibility: "list", supported_reasoning_levels: {} as never }],
        }),
      ).toThrow("invalid model")
      expect(Object.keys(models)).toEqual(["current"])
    })

    test("clears stale capabilities and variants on existing models", () => {
      const models = {
        existing: {
          id: "existing",
          providerID: "openai",
          api: { id: "existing", npm: "@ai-sdk/openai" },
          name: "Existing",
          capabilities: {
            reasoning: true,
            attachment: true,
            input: { text: true, audio: false, image: true, video: false, pdf: false },
          },
          cost: { input: 1, output: 1, cache: { read: 0, write: 0 } },
          limit: { context: 100, output: 10 },
          variants: { high: { reasoningEffort: "high" } },
        },
      } as unknown as Provider.Info["models"]

      CodexModels.apply(models, {
        models: [
          {
            slug: "existing",
            visibility: "list",
            supported_reasoning_levels: [],
            input_modalities: ["text"],
          },
        ],
      })

      expect(models.existing?.capabilities.reasoning).toBe(false)
      expect(models.existing?.capabilities.input.image).toBe(false)
      expect(models.existing?.variants).toEqual({})
    })

    test("omits reasoning summary options when the remote model does not support them", () => {
      const models = {} as Provider.Info["models"]
      CodexModels.apply(models, {
        models: [
          {
            slug: "no-summary",
            visibility: "list",
            supported_reasoning_levels: ["high"],
            supports_reasoning_summary_parameter: false,
          },
        ],
      })

      expect(models["no-summary"]?.variants.high).toEqual({ reasoningEffort: "high" })
    })

    test("omits the unsupported none reasoning summary literal", () => {
      const models = {} as Provider.Info["models"]
      CodexModels.apply(models, {
        models: [
          {
            slug: "none-summary",
            visibility: "list",
            supported_reasoning_levels: ["medium"],
            supports_reasoning_summary_parameter: true,
            default_reasoning_summary: "none",
          },
        ],
      })

      expect(models["none-summary"]?.variants.medium).toEqual({ reasoningEffort: "medium" })
    })
  })

  describe("parseJwtClaims", () => {
    test("parses valid JWT with claims", () => {
      const payload = { email: "test@example.com", chatgpt_account_id: "acc-123" }
      const jwt = createTestJwt(payload)
      const claims = parseJwtClaims(jwt)
      expect(claims).toEqual(payload)
    })

    test("returns undefined for JWT with less than 3 parts", () => {
      expect(parseJwtClaims("invalid")).toBeUndefined()
      expect(parseJwtClaims("only.two")).toBeUndefined()
    })

    test("returns undefined for invalid base64", () => {
      expect(parseJwtClaims("a.!!!invalid!!!.b")).toBeUndefined()
    })

    test("returns undefined for invalid JSON payload", () => {
      const header = Buffer.from("{}").toString("base64url")
      const invalidJson = Buffer.from("not json").toString("base64url")
      expect(parseJwtClaims(`${header}.${invalidJson}.sig`)).toBeUndefined()
    })
  })

  describe("extractAccountIdFromClaims", () => {
    test("extracts chatgpt_account_id from root", () => {
      const claims: IdTokenClaims = { chatgpt_account_id: "acc-root" }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts chatgpt_account_id from nested https://api.openai.com/auth", () => {
      const claims: IdTokenClaims = {
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-nested")
    })

    test("prefers root over nested", () => {
      const claims: IdTokenClaims = {
        chatgpt_account_id: "acc-root",
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts from organizations array as fallback", () => {
      const claims: IdTokenClaims = {
        organizations: [{ id: "org-123" }, { id: "org-456" }],
      }
      expect(extractAccountIdFromClaims(claims)).toBe("org-123")
    })

    test("returns undefined when no accountId found", () => {
      const claims: IdTokenClaims = { email: "test@example.com" }
      expect(extractAccountIdFromClaims(claims)).toBeUndefined()
    })
  })

  describe("extractAccountId", () => {
    test("extracts from id_token first", () => {
      const idToken = createTestJwt({ chatgpt_account_id: "from-id-token" })
      const accessToken = createTestJwt({ chatgpt_account_id: "from-access-token" })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-id-token")
    })

    test("falls back to access_token when id_token has no accountId", () => {
      const idToken = createTestJwt({ email: "test@example.com" })
      const accessToken = createTestJwt({
        "https://api.openai.com/auth": { chatgpt_account_id: "from-access" },
      })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-access")
    })

    test("returns undefined when no tokens have accountId", () => {
      const token = createTestJwt({ email: "test@example.com" })
      expect(
        extractAccountId({
          id_token: token,
          access_token: token,
          refresh_token: "rt",
        }),
      ).toBeUndefined()
    })

    test("handles missing id_token", () => {
      const accessToken = createTestJwt({ chatgpt_account_id: "acc-123" })
      expect(
        extractAccountId({
          id_token: "",
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("acc-123")
    })
  })
})
