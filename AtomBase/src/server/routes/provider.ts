import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { mapValues } from "remeda"
import { Config } from "@/core/config/config"
import { ModelsDev } from "@/integrations/provider/models"
import { Provider } from "@/integrations/provider/provider"
import { ProviderAuth } from "@/integrations/provider/auth"
import { errors } from "../error"
import { fetchOpenAICompatibleModels } from "@/integrations/provider/custom"
import { Global } from "@/core/global"
import { Auth } from "@/services/auth"
import fs from "fs/promises"
import { mergeDeep } from "remeda"

export const ProviderRoute = new Hono()
  .get(
    "/",
    describeRoute({
      summary: "List providers",
      description: "Get a list of all available AI providers, including both available and connected ones.",
      operationId: "provider.list",
      responses: {
        200: {
          description: "List of providers",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  all: ModelsDev.Provider.array(),
                  default: z.record(z.string(), z.string()),
                  connected: z.array(z.string()),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const config = await Config.get()
      const disabled = new Set(config.disabled_providers ?? [])
      const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

      const allProviders = await ModelsDev.get()
      const filteredProviders: Record<string, (typeof allProviders)[string]> = {}
      for (const [key, value] of Object.entries(allProviders)) {
        if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
          filteredProviders[key] = value
        }
      }

      // Always include Ollama as a local LLM option
      if (!disabled.has("ollama") && !filteredProviders["ollama"]) {
        filteredProviders["ollama"] = {
          id: "ollama",
          name: "Ollama",
          api: "http://localhost:11434/v1",
          npm: "@atomcli/ollama",
          env: ["OLLAMA_HOST"],
          models: {},
        }
      }

      // Kilocode only appears when authenticated (models populated dynamically)

      const connected = await Provider.list()
      const providers = Object.assign(
        mapValues(filteredProviders, (x) => Provider.fromModelsDevProvider(x)),
        connected,
      )
      return c.json({
        all: Object.values(providers),
        default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0]?.id ?? ""),
        connected: Object.keys(connected),
      })
    },
  )
  .get(
    "/auth",
    describeRoute({
      summary: "Get provider auth methods",
      description: "Retrieve available authentication methods for all AI providers.",
      operationId: "provider.auth",
      responses: {
        200: {
          description: "Provider auth methods",
          content: {
            "application/json": {
              schema: resolver(z.record(z.string(), z.array(ProviderAuth.Method))),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json(await ProviderAuth.methods())
    },
  )
  .post(
    "/:providerID/oauth/authorize",
    describeRoute({
      summary: "OAuth authorize",
      description: "Initiate OAuth authorization for a specific AI provider to get an authorization URL.",
      operationId: "provider.oauth.authorize",
      responses: {
        200: {
          description: "Authorization URL and method",
          content: {
            "application/json": {
              schema: resolver(ProviderAuth.Authorization.optional()),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator(
      "param",
      z.object({
        providerID: z.string().meta({ description: "Provider ID" }),
      }),
    ),
    validator(
      "json",
      z.object({
        method: z.number().meta({ description: "Auth method index" }),
      }),
    ),
    async (c) => {
      const providerID = c.req.valid("param").providerID
      const { method } = c.req.valid("json")
      const result = await ProviderAuth.authorize({
        providerID,
        method,
      })
      return c.json(result)
    },
  )
  .post(
    "/:providerID/oauth/callback",
    describeRoute({
      summary: "OAuth callback",
      description: "Handle the OAuth callback from a provider after user authorization.",
      operationId: "provider.oauth.callback",
      responses: {
        200: {
          description: "OAuth callback processed successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator(
      "param",
      z.object({
        providerID: z.string().meta({ description: "Provider ID" }),
      }),
    ),
    validator(
      "json",
      z.object({
        method: z.number().meta({ description: "Auth method index" }),
        code: z.string().optional().meta({ description: "OAuth authorization code" }),
      }),
    ),
    async (c) => {
      const providerID = c.req.valid("param").providerID
      const { method, code } = c.req.valid("json")
      await ProviderAuth.callback({
        providerID,
        method,
        code,
      })
      return c.json(true)
    },
  )
  .post(
    "/:providerID/key",
    describeRoute({
      summary: "Set API key",
      description: "Set the API key for a specific AI provider.",
      operationId: "provider.key",
      responses: {
        200: {
          description: "API key saved successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator(
      "param",
      z.object({
        providerID: z.string().meta({ description: "Provider ID" }),
      }),
    ),
    validator(
      "json",
      z.object({
        key: z.string().meta({ description: "API key for the provider" }),
      }),
    ),
    async (c) => {
      const providerID = c.req.valid("param").providerID
      const { key } = c.req.valid("json")
      await ProviderAuth.api({ providerID, key })
      return c.json(true)
    },
  )
  .post(
    "/custom/discover",
    describeRoute({
      summary: "Discover custom provider models",
      description: "Probe an OpenAI-compatible base URL and return the discovered model list.",
      operationId: "provider.custom.discover",
      responses: {
        200: {
          description: "Discovery result",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  ok: z.boolean(),
                  models: z
                    .object({
                      id: z.string(),
                      name: z.string(),
                      tool_call: z.boolean(),
                      reasoning: z.boolean(),
                      attachment: z.boolean(),
                      temperature: z.boolean(),
                      limit: z.object({ context: z.number(), output: z.number() }),
                    })
                    .array(),
                  error: z.string().optional(),
                }),
              ),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator(
      "json",
      z.object({
        baseURL: z
          .string()
          .url()
          .refine((url) => /^https?:\/\//i.test(url), "Only HTTP/HTTPS URLs are allowed")
          .meta({ description: "OpenAI-compatible base URL" }),
        apiKey: z.string().optional().meta({ description: "Optional API key" }),
      }),
    ),
    async (c) => {
      const { baseURL, apiKey } = c.req.valid("json")
      const result = await fetchOpenAICompatibleModels({
        baseURL,
        apiKey: apiKey || undefined,
        timeout: 10_000,
      })
      return c.json(result)
    },
  )
  .post(
    "/custom/save",
    describeRoute({
      summary: "Save a custom provider configuration",
      description: "Persist a custom OpenAI-compatible provider to the global atomcli.json config.",
      operationId: "provider.custom.save",
      responses: {
        200: {
          description: "Saved successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator(
      "json",
      z.object({
        providerID: z
          .string()
          .regex(/^[0-9a-z-]+$/, "Provider ID must contain only a-z, 0-9 and hyphens")
          .refine((id) => !["__proto__", "constructor", "prototype"].includes(id), "Invalid provider ID")
          .meta({ description: "Provider identifier (a-z, 0-9, hyphens)" }),
        name: z.string().min(1).meta({ description: "Display name" }),
        baseURL: z
          .string()
          .url()
          .refine((url) => /^https?:\/\//i.test(url), "Only HTTP/HTTPS URLs are allowed")
          .meta({ description: "API base URL" }),
        apiKey: z.string().optional().meta({ description: "Optional API key" }),
        models: z.record(z.string(), z.any()).meta({ description: "Model config map" }),
      }),
    ),
    async (c) => {
      const { providerID, name, baseURL, apiKey, models } = c.req.valid("json")

      // Persist API key in secure auth store (auth.json)
      if (apiKey) {
        await Auth.set(providerID, { type: "api", key: apiKey })
      }

      // Merge into global config without storing plaintext API key
      const configPath = `${Global.Path.config}/atomcli.json`
      await fs.mkdir(Global.Path.config, { recursive: true })
      const existing = await Bun.file(configPath)
        .json()
        .catch(() => ({}))

      const providerEntry = {
        name,
        npm: "@ai-sdk/openai-compatible",
        api: baseURL,
        options: {
          baseURL,
        },
        models,
      }

      const updated = mergeDeep(existing, { provider: { [providerID]: providerEntry } })
      await Bun.write(configPath, JSON.stringify(updated, null, 2))

      return c.json(true)
    },
  )
