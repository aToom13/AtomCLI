import { Auth } from "@/services/auth"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { ModelsDev } from "@/integrations/provider/models"
import { map, mergeDeep, pipe, sortBy } from "remeda"
import path from "path"
import os from "os"
import fs from "fs/promises"
import { Config } from "@/core/config/config"
import { Global } from "@/core/global"
import { Plugin } from "@/integrations/plugin"
import { fetchOpenAICompatibleModels } from "@/integrations/provider/custom"
import { Instance } from "@/services/project/instance"
import type { Hooks } from "@atomcli/plugin"

type PluginAuth = NonNullable<Hooks["auth"]>

export namespace AuthLogin {
  export type ProviderOption = {
    id: string
    name: string
    env: string[]
    models: Record<string, unknown>
  }

  export function providers(
    database: Record<string, ModelsDev.Provider>,
    plugins: Array<{ auth?: PluginAuth }>,
    config: Pick<Config.Info, "disabled_providers" | "enabled_providers">,
  ): ProviderOption[] {
    const disabled = new Set(config.disabled_providers ?? [])
    const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined
    const result = new Map<string, ProviderOption>()

    for (const [providerID, provider] of Object.entries(database)) {
      if (disabled.has(providerID) || (enabled && !enabled.has(providerID))) continue
      result.set(providerID, provider)
    }

    for (const plugin of plugins) {
      const providerID = plugin.auth?.provider
      if (!providerID || result.has(providerID)) continue
      if (disabled.has(providerID) || (enabled && !enabled.has(providerID))) continue
      result.set(providerID, {
        id: providerID,
        name: providerID.charAt(0).toUpperCase() + providerID.slice(1),
        env: [],
        models: {},
      })
    }

    const priority: Record<string, number> = {
      atomcli: 0,
      anthropic: 1,
      "github-copilot": 2,
      openai: 3,
      google: 4,
      antigravity: 5,
      openrouter: 6,
      vercel: 7,
    }

    return pipe(
      [...result.values()],
      sortBy(
        (provider) => priority[provider.id] ?? 99,
        (provider) => provider.name ?? provider.id,
      ),
    )
  }
}

/**
 * Handle plugin-based authentication flow.
 * Returns true if auth was handled, false if it should fall through to default handling.
 */
async function handlePluginAuth(
  plugin: { auth: PluginAuth },
  provider: string,
  methodIndex?: string,
): Promise<boolean> {
  let index = 0
  if (methodIndex !== undefined) {
    index = parseInt(methodIndex)
  } else if (plugin.auth.methods.length > 1) {
    const method = await prompts.select({
      message: "Login method",
      options: [
        ...plugin.auth.methods.map((x, index) => ({
          label: x.label,
          value: index.toString(),
        })),
      ],
    })
    if (prompts.isCancel(method)) throw new UI.CancelledError()
    index = parseInt(method)
  }
  const method = plugin.auth.methods[index]

  // Handle prompts for all auth types
  await Bun.sleep(10)
  const inputs: Record<string, string> = {}
  if (method.prompts) {
    for (const prompt of method.prompts) {
      if (prompt.condition && !prompt.condition(inputs)) {
        continue
      }
      if (prompt.type === "select") {
        const value = await prompts.select({
          message: prompt.message,
          options: prompt.options,
        })
        if (prompts.isCancel(value)) throw new UI.CancelledError()
        inputs[prompt.key] = value
      } else {
        const value = await prompts.text({
          message: prompt.message,
          placeholder: prompt.placeholder,
          validate: prompt.validate ? (v) => prompt.validate!(v ?? "") : undefined,
        })
        if (prompts.isCancel(value)) throw new UI.CancelledError()
        inputs[prompt.key] = value
      }
    }
  }

  if (method.type === "oauth") {
    let authorize
    try {
      authorize = await method.authorize(inputs)
    } catch (error: any) {
      prompts.log.error(error?.message || "Failed to start authorization flow")
      return true
    }

    if (authorize.url) {
      prompts.log.info("Go to: " + authorize.url)
    }

    if (authorize.method === "auto") {
      if (authorize.instructions) {
        prompts.log.info(authorize.instructions)
      }
      const spinner = prompts.spinner()
      spinner.start("Waiting for authorization...")
      const result = await authorize.callback()
      if (result.type === "failed") {
        spinner.stop("Failed to authorize", 1)
      }
      if (result.type === "success") {
        const saveProvider = result.provider ?? provider
        if ("refresh" in result) {
          const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
          await Auth.set(saveProvider, {
            type: "oauth",
            refresh,
            access,
            expires,
            ...extraFields,
          })
        }
        if ("key" in result) {
          await Auth.set(saveProvider, {
            type: "api",
            key: result.key,
          })
        }
        spinner.stop("Login successful")
      }
    }

    if (authorize.method === "code") {
      const code = await prompts.text({
        message: "Paste the authorization code here: ",
        validate: (x) => (x && x.length > 0 ? undefined : "Required"),
      })
      if (prompts.isCancel(code)) throw new UI.CancelledError()
      const result = await authorize.callback(code)
      if (result.type === "failed") {
        prompts.log.error("Failed to authorize")
      }
      if (result.type === "success") {
        const saveProvider = result.provider ?? provider
        if ("refresh" in result) {
          const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
          await Auth.set(saveProvider, {
            type: "oauth",
            refresh,
            access,
            expires,
            ...extraFields,
          })
        }
        if ("key" in result) {
          await Auth.set(saveProvider, {
            type: "api",
            key: result.key,
          })
        }
        prompts.log.success("Login successful")
      }
    }

    prompts.outro("Done")
    return true
  }

  if (method.type === "api") {
    if (method.authorize) {
      let result
      try {
        result = await method.authorize(inputs)
      } catch (error: any) {
        prompts.log.error(error?.message || "Failed to start authorization flow")
        return true
      }
      if (result.type === "failed") {
        prompts.log.error("Failed to authorize")
      }
      if (result.type === "success") {
        const saveProvider = result.provider ?? provider
        await Auth.set(saveProvider, {
          type: "api",
          key: result.key,
        })
        prompts.log.success("Login successful")
      }
      prompts.outro("Done")
      return true
    }
  }

  return false
}

export const AuthCommand = cmd({
  command: "auth",
  describe: "manage credentials",
  builder: (yargs) =>
    yargs.command(AuthLoginCommand).command(AuthLogoutCommand).command(AuthListCommand).demandCommand(),
  async handler() {},
})

export const AuthListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list providers",
  async handler() {
    UI.empty()
    const authPath = path.join(Global.Path.data, "auth.json")
    const homedir = os.homedir()
    const displayPath = authPath.startsWith(homedir) ? authPath.replace(homedir, "~") : authPath
    prompts.intro(`Credentials ${UI.Style.TEXT_DIM}${displayPath}`)
    const results = Object.entries(await Auth.all())
    const database = await ModelsDev.get()

    for (const [providerID, result] of results) {
      const name = database[providerID]?.name || providerID
      prompts.log.info(`${name} ${UI.Style.TEXT_DIM}${result.type}`)
    }

    prompts.outro(`${results.length} credentials`)

    // Environment variables section
    const activeEnvVars: Array<{ provider: string; envVar: string }> = []

    for (const [providerID, provider] of Object.entries(database)) {
      for (const envVar of provider.env) {
        if (process.env[envVar]) {
          activeEnvVars.push({
            provider: provider.name || providerID,
            envVar,
          })
        }
      }
    }

    if (activeEnvVars.length > 0) {
      UI.empty()
      prompts.intro("Environment")

      for (const { provider, envVar } of activeEnvVars) {
        prompts.log.info(`${provider} ${UI.Style.TEXT_DIM}${envVar}`)
      }

      prompts.outro(`${activeEnvVars.length} environment variable` + (activeEnvVars.length === 1 ? "" : "s"))
    }
  },
})

export const AuthLoginCommand = cmd({
  command: "login [url]",
  describe: "log in to a provider",
  builder: (yargs) =>
    yargs
      .positional("url", {
        describe: "atomcli auth provider",
        type: "string",
      })
      .option("provider", {
        type: "string",
        describe: "Directly login to a specific provider ID (e.g. kilocode)",
      })
      .option("method", {
        type: "string",
        describe: "Bypass method selection prompt if multiple exist",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Add credential")
        if (args.url) {
          const wellknown = await fetch(`${args.url}/.well-known/atomcli`).then((x) => x.json() as any)
          prompts.log.info(`Running \`${wellknown.auth.command.join(" ")}\``)
          const proc = Bun.spawn({
            cmd: wellknown.auth.command,
            stdout: "pipe",
          })
          const exit = await proc.exited
          if (exit !== 0) {
            prompts.log.error("Failed")
            prompts.outro("Done")
            return
          }
          const token = await new Response(proc.stdout).text()
          await Auth.set(args.url, {
            type: "wellknown",
            key: wellknown.auth.env,
            token: token.trim(),
          })
          prompts.log.success("Logged into " + args.url)
          prompts.outro("Done")
          return
        }
        await ModelsDev.refresh().catch(() => {})

        const config = await Config.get()

        const providers = AuthLogin.providers(await ModelsDev.get(), await Plugin.list(), config)
        let provider = args.provider as string
        if (!provider) {
          provider = (await prompts.autocomplete({
            message: "Select provider",
            maxItems: 8,
            options: [
              {
                value: "custom",
                label: "Custom Provider (OpenAI Compatible)",
                hint: "9Route, LiteLLM, local /v1",
              },
              ...pipe(
                providers,
                map((x) => ({
                  label: x.name,
                  value: x.id,
                  hint: {
                    atomcli: "recommended",
                    anthropic: "Claude Max or API key",
                    openai: "ChatGPT Plus/Pro or API key",
                    antigravity: "Google OAuth → Claude & Gemini",
                  }[x.id],
                })),
              ),
            ],
          })) as string
          if (prompts.isCancel(provider)) throw new UI.CancelledError()
        }

        if (provider === "custom") {
          const customId = (await prompts.text({
            message: "Enter provider ID",
            placeholder: "e.g., 9route, local-llm, custom-gateway",
            validate: (x) => (x && x.trim().match(/^[0-9a-z-]+$/) ? undefined : "a-z, 0-9 and hyphens only"),
          })) as string
          if (prompts.isCancel(customId)) throw new UI.CancelledError()
          const providerID = customId.trim().replace(/^@ai-sdk\//, "")

          const defaultName = providerID.charAt(0).toUpperCase() + providerID.slice(1)
          const customName = (await prompts.text({
            message: "Enter provider display name",
            placeholder: defaultName,
            defaultValue: defaultName,
          })) as string
          if (prompts.isCancel(customName)) throw new UI.CancelledError()
          const providerName = (customName && customName.trim()) || defaultName

          const customURL = (await prompts.text({
            message: "Enter API Base URL",
            placeholder: "e.g., http://localhost:20128/v1 or https://api.9route.com/v1",
            validate: (x) => {
              if (!x || !x.trim()) return "Endpoint URL is required"
              try {
                new URL(x.trim())
                return undefined
              } catch {
                return "Invalid URL format"
              }
            },
          })) as string
          if (prompts.isCancel(customURL)) throw new UI.CancelledError()
          const baseURL = customURL.trim().replace(/\/+$/, "")

          const apiKey = (await prompts.password({
            message: "Enter API key (press Enter if none)",
            validate: () => undefined,
          })) as string
          if (prompts.isCancel(apiKey)) throw new UI.CancelledError()
          const key = apiKey ? apiKey.trim() : ""

          const spinner = prompts.spinner()
          spinner.start(`Discovering models from ${baseURL}...`)
          const discovery = await fetchOpenAICompatibleModels({
            baseURL,
            apiKey: key || undefined,
            timeout: 10_000,
          })

          const modelsConfig: Record<string, any> = {}

          if (discovery.ok && discovery.models.length > 0) {
            const sample = discovery.models
              .slice(0, 3)
              .map((m) => m.id)
              .join(", ")
            spinner.stop(
              `Discovered ${discovery.models.length} model${discovery.models.length === 1 ? "" : "s"} (${sample}${discovery.models.length > 3 ? ", ..." : ""})`,
            )
            for (const m of discovery.models) {
              modelsConfig[m.id] = {
                name: m.name,
                tool_call: m.tool_call,
                reasoning: m.reasoning,
                attachment: m.attachment,
                temperature: m.temperature,
                ...(m.interleaved ? { interleaved: m.interleaved } : {}),
                limit: m.limit,
                ...(m.modalities ? { modalities: m.modalities } : {}),
                ...(m.cost ? { cost: m.cost } : {}),
              }
            }
          } else {
            spinner.stop(`Could not auto-discover models (${discovery.error || "empty model list"})`)
            const modelIdInput = (await prompts.text({
              message: "Enter a default model name",
              placeholder: "e.g., gpt-4o, deepseek-r1, llama-3.3-70b",
              validate: (x) => (x && x.trim().length > 0 ? undefined : "Model name is required"),
            })) as string
            if (prompts.isCancel(modelIdInput)) throw new UI.CancelledError()
            const modelId = modelIdInput.trim()
            modelsConfig[modelId] = {
              name: modelId,
              tool_call: true,
              limit: {
                context: 128000,
                output: 8192,
              },
            }
          }

          if (key) {
            await Auth.set(providerID, {
              type: "api",
              key,
            })
          }

          const configPath = path.join(Global.Path.config, "atomcli.json")
          await fs.mkdir(Global.Path.config, { recursive: true })
          const existingConfig = await Bun.file(configPath)
            .json()
            .catch(() => ({}))

          const providerEntry = {
            name: providerName,
            npm: "@ai-sdk/openai-compatible",
            api: baseURL,
            options: {
              baseURL,
              ...(key ? { apiKey: key } : {}),
            },
            models: modelsConfig,
          }

          const updatedConfig = mergeDeep(existingConfig, {
            provider: {
              [providerID]: providerEntry,
            },
          })

          await Bun.write(configPath, JSON.stringify(updatedConfig, null, 2))

          prompts.log.success(
            `Provider '${providerID}' successfully configured with ${Object.keys(modelsConfig).length} model${Object.keys(modelsConfig).length === 1 ? "" : "s"}`,
          )
          prompts.outro("Done")
          return
        }

        const plugin = await Plugin.list().then((x) => x.find((x) => x.auth?.provider === provider))
        if (plugin && plugin.auth) {
          const handled = await handlePluginAuth({ auth: plugin.auth }, provider, args.method as string | undefined)
          if (handled) return
        }

        if (provider === "other") {
          provider = (await prompts.text({
            message: "Enter provider id",
            validate: (x) => (x && x.match(/^[0-9a-z-]+$/) ? undefined : "a-z, 0-9 and hyphens only"),
          })) as string
          if (prompts.isCancel(provider)) throw new UI.CancelledError()
          provider = provider.replace(/^@ai-sdk\//, "")
          if (prompts.isCancel(provider)) throw new UI.CancelledError()

          // Check if a plugin provides auth for this custom provider
          const customPlugin = await Plugin.list().then((x) => x.find((x) => x.auth?.provider === provider))
          if (customPlugin && customPlugin.auth) {
            const handled = await handlePluginAuth({ auth: customPlugin.auth }, provider)
            if (handled) return
          }

          prompts.log.warn(
            `This only stores a credential for ${provider} - you will need configure it in atomcli.json, check the docs for examples.`,
          )
        }

        if (provider === "amazon-bedrock") {
          prompts.log.info(
            "Amazon Bedrock authentication priority:\n" +
              "  1. Bearer token (AWS_BEARER_TOKEN_BEDROCK or /connect)\n" +
              "  2. AWS credential chain (profile, access keys, IAM roles)\n\n" +
              "Configure via atomcli.json options (profile, region, endpoint) or\n" +
              "AWS environment variables (AWS_PROFILE, AWS_REGION, AWS_ACCESS_KEY_ID).",
          )
        }

        if (provider === "atomcli") {
          prompts.log.info("Create an api key at https://atomcli.ai/auth")
        }

        if (provider === "vercel") {
          prompts.log.info("You can create an api key at https://vercel.link/ai-gateway-token")
        }

        if (["cloudflare", "cloudflare-ai-gateway"].includes(provider)) {
          prompts.log.info(
            "Cloudflare AI Gateway can be configured with CLOUDFLARE_GATEWAY_ID, CLOUDFLARE_ACCOUNT_ID, and CLOUDFLARE_API_TOKEN environment variables. Read more: https://atomcli.ai/docs/providers/#cloudflare-ai-gateway",
          )
        }

        const key = await prompts.password({
          message: "Enter your API key",
          validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(key)) throw new UI.CancelledError()
        await Auth.set(provider, {
          type: "api",
          key,
        })

        prompts.outro("Done")
      },
    })
  },
})

export const AuthLogoutCommand = cmd({
  command: "logout",
  describe: "log out from a configured provider",
  async handler() {
    UI.empty()
    const credentials = await Auth.all().then((x) => Object.entries(x))
    prompts.intro("Remove credential")
    if (credentials.length === 0) {
      prompts.log.error("No credentials found")
      return
    }
    const database = await ModelsDev.get()
    const providerID = await prompts.select({
      message: "Select provider",
      options: credentials.map(([key, value]) => ({
        label: (database[key]?.name || key) + UI.Style.TEXT_DIM + " (" + value.type + ")",
        value: key,
      })),
    })
    if (prompts.isCancel(providerID)) throw new UI.CancelledError()
    await Auth.remove(providerID)
    prompts.outro("Logout successful")
  },
})
