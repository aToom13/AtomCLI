import { Config } from "@/core/config/config"
import { Env } from "@/core/env"
import { Auth } from "@/services/auth"
import { BunProc } from "@/util/bun"
import { iife } from "@/util/util/iife"
import type { AmazonBedrockProviderSettings } from "@ai-sdk/amazon-bedrock"
import { detectOllama, toProviderModels } from "./ollama"
import { detectKilocode, getKilocodeModels } from "./kilocode"
import { ProviderModels } from "./models-runtime"

type Info = ProviderModels.Info
type Model = ProviderModels.Model
export type CustomModelLoader = (sdk: any, modelID: string, options?: Record<string, any>) => Promise<any>
type CustomLoader = (provider: Info) => Promise<{
  autoload: boolean
  getModel?: CustomModelLoader
  options?: Record<string, any>
  models?: Record<string, Model>
}>

async function loadZenProvider(input: Info) {
  if (!input) return { autoload: false }
  const config = await Config.get()
  const auth = await Auth.get(input.id)
  const apiKey =
    config.provider?.[input.id]?.options?.apiKey ??
    (auth?.type === "api" ? auth.key : undefined) ??
    input.env?.map(Env.get).find(Boolean)
  if ((!apiKey || apiKey === "public") && input.models) {
    for (const [id, model] of Object.entries(input.models)) {
      if (id === "atomcli-auto" || id === "atomcli-free") continue
      if (!ProviderModels.isPublicAtomCLIModel(model)) delete input.models[id]
    }
  }
  return {
    autoload: Object.keys(input.models ?? {}).length > 0,
    options: { apiKey: apiKey || "public" },
    models: input.models,
  }
}

export const CUSTOM_LOADERS: Record<string, CustomLoader> = {
  async anthropic() {
    return {
      autoload: false,
      options: {
        headers: {
          "anthropic-beta":
            "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
        },
      },
    }
  },
  atomcli: loadZenProvider,
  opencode: loadZenProvider,
  // Ollama - Auto-detect running instances and available models
  ollama: async () => {
    const baseURL = Env.get("OLLAMA_HOST") ?? "http://localhost:11434"
    // F3: timeout Ollama probe to avoid blocking cold start
    const OLLAMA_DETECT_TIMEOUT_MS = 2_000
    const { running, models } = await Promise.race([
      detectOllama(baseURL),
      new Promise<{ running: false; models: never[] }>((resolve) =>
        setTimeout(() => resolve({ running: false, models: [] }), OLLAMA_DETECT_TIMEOUT_MS),
      ),
    ])

    if (!running) {
      return {
        autoload: false,
        options: {},
      }
    }

    return {
      autoload: models.length > 0,
      options: {
        baseURL: `${baseURL}/v1`,
      },
      models: toProviderModels(models),
    }
  },
  openai: async () => {
    return {
      autoload: false,
      async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
        return sdk.responses(modelID)
      },
      options: {},
    }
  },
  "github-copilot": async () => {
    return {
      autoload: false,
      async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
        if (modelID.includes("codex")) {
          return sdk.responses(modelID)
        }
        return sdk.chat(modelID)
      },
      options: {},
    }
  },
  "github-copilot-enterprise": async () => {
    return {
      autoload: false,
      async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
        if (modelID.includes("codex")) {
          return sdk.responses(modelID)
        }
        return sdk.chat(modelID)
      },
      options: {},
    }
  },
  azure: async () => {
    return {
      autoload: false,
      async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
        if (options?.["useCompletionUrls"]) {
          return sdk.chat(modelID)
        } else {
          return sdk.responses(modelID)
        }
      },
      options: {},
    }
  },
  "azure-cognitive-services": async () => {
    const resourceName = Env.get("AZURE_COGNITIVE_SERVICES_RESOURCE_NAME")
    return {
      autoload: false,
      async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
        if (options?.["useCompletionUrls"]) {
          return sdk.chat(modelID)
        } else {
          return sdk.responses(modelID)
        }
      },
      options: {
        baseURL: resourceName ? `https://${resourceName}.cognitiveservices.azure.com/openai` : undefined,
      },
    }
  },
  "amazon-bedrock": async () => {
    const config = await Config.get()
    const providerConfig = config.provider?.["amazon-bedrock"]

    const auth = await Auth.get("amazon-bedrock")

    // Region precedence: 1) config file, 2) env var, 3) default
    const configRegion = providerConfig?.options?.region
    const envRegion = Env.get("AWS_REGION")
    const defaultRegion = configRegion ?? envRegion ?? "us-east-1"

    // Profile: config file takes precedence over env var
    const configProfile = providerConfig?.options?.profile
    const envProfile = Env.get("AWS_PROFILE")
    const profile = configProfile ?? envProfile

    const awsAccessKeyId = Env.get("AWS_ACCESS_KEY_ID")

    const awsBearerToken = iife(() => {
      const envToken = Env.get("AWS_BEARER_TOKEN_BEDROCK")
      if (envToken) return envToken
      if (auth?.type === "api") return auth.key
      return undefined
    })

    if (!profile && !awsAccessKeyId && !awsBearerToken) return { autoload: false }

    let profileCredentials: Promise<any> | undefined
    const providerOptions: AmazonBedrockProviderSettings = {
      region: defaultRegion,
      ...(awsBearerToken ? { apiKey: awsBearerToken } : {}),
      // Shared AWS profiles need the optional credential package. Resolve it
      // only when the first Bedrock request asks for credentials; provider
      // discovery must never install packages or block cold start on network.
      ...(profile
        ? {
            credentialProvider: async () => {
              profileCredentials ??= (async () => {
                const modulePath = await BunProc.install("@aws-sdk/credential-providers")
                const { fromNodeProviderChain } = await import(modulePath)
                return fromNodeProviderChain({ profile })()
              })().catch((error) => {
                profileCredentials = undefined
                throw error
              })
              return profileCredentials
            },
          }
        : {}),
    }

    // Add custom endpoint if specified (endpoint takes precedence over baseURL)
    const endpoint = providerConfig?.options?.endpoint ?? providerConfig?.options?.baseURL
    if (endpoint) {
      providerOptions.baseURL = endpoint
    }

    return {
      autoload: true,
      options: providerOptions,
      async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
        // Skip region prefixing if model already has a cross-region inference profile prefix
        if (modelID.startsWith("global.") || modelID.startsWith("jp.")) {
          return sdk.languageModel(modelID)
        }

        // Region resolution precedence (highest to lowest):
        // 1. options.region from atomcli.json provider config
        // 2. defaultRegion from AWS_REGION environment variable
        // 3. Default "us-east-1" (baked into defaultRegion)
        const region = options?.region ?? defaultRegion

        let regionPrefix = region.split("-")[0]

        switch (regionPrefix) {
          case "us": {
            const modelRequiresPrefix = [
              "nova-micro",
              "nova-lite",
              "nova-pro",
              "nova-premier",
              "claude",
              "deepseek",
            ].some((m) => modelID.includes(m))
            const isGovCloud = region.startsWith("us-gov")
            if (modelRequiresPrefix && !isGovCloud) {
              modelID = `${regionPrefix}.${modelID}`
            }
            break
          }
          case "eu": {
            const regionRequiresPrefix = [
              "eu-west-1",
              "eu-west-2",
              "eu-west-3",
              "eu-north-1",
              "eu-central-1",
              "eu-south-1",
              "eu-south-2",
            ].some((r) => region.includes(r))
            const modelRequiresPrefix = ["claude", "nova-lite", "nova-micro", "llama3", "pixtral"].some((m) =>
              modelID.includes(m),
            )
            if (regionRequiresPrefix && modelRequiresPrefix) {
              modelID = `${regionPrefix}.${modelID}`
            }
            break
          }
          case "ap": {
            const isAustraliaRegion = ["ap-southeast-2", "ap-southeast-4"].includes(region)
            const isTokyoRegion = region === "ap-northeast-1"
            if (
              isAustraliaRegion &&
              ["anthropic.claude-sonnet-4-5", "anthropic.claude-haiku"].some((m) => modelID.includes(m))
            ) {
              regionPrefix = "au"
              modelID = `${regionPrefix}.${modelID}`
            } else if (isTokyoRegion) {
              // Tokyo region uses jp. prefix for cross-region inference
              const modelRequiresPrefix = ["claude", "nova-lite", "nova-micro", "nova-pro"].some((m) =>
                modelID.includes(m),
              )
              if (modelRequiresPrefix) {
                regionPrefix = "jp"
                modelID = `${regionPrefix}.${modelID}`
              }
            } else {
              // Other APAC regions use apac. prefix
              const modelRequiresPrefix = ["claude", "nova-lite", "nova-micro", "nova-pro"].some((m) =>
                modelID.includes(m),
              )
              if (modelRequiresPrefix) {
                regionPrefix = "apac"
                modelID = `${regionPrefix}.${modelID}`
              }
            }
            break
          }
        }

        return sdk.languageModel(modelID)
      },
    }
  },
  openrouter: async () => {
    return {
      autoload: false,
      options: {
        headers: {
          "HTTP-Referer": "https://atomcli.ai/",
          "X-Title": "atomcli",
        },
      },
    }
  },
  vercel: async () => {
    return {
      autoload: false,
      options: {
        headers: {
          "http-referer": "https://atomcli.ai/",
          "x-title": "atomcli",
        },
      },
    }
  },
  "google-vertex": async () => {
    const project = Env.get("GOOGLE_CLOUD_PROJECT") ?? Env.get("GCP_PROJECT") ?? Env.get("GCLOUD_PROJECT")
    const location = Env.get("GOOGLE_CLOUD_LOCATION") ?? Env.get("VERTEX_LOCATION") ?? "us-east5"
    const autoload = Boolean(project)
    if (!autoload) return { autoload: false }
    return {
      autoload: true,
      options: {
        project,
        location,
      },
      async getModel(sdk: any, modelID: string) {
        const id = String(modelID).trim()
        return sdk.languageModel(id)
      },
    }
  },
  "google-vertex-anthropic": async () => {
    const project = Env.get("GOOGLE_CLOUD_PROJECT") ?? Env.get("GCP_PROJECT") ?? Env.get("GCLOUD_PROJECT")
    const location = Env.get("GOOGLE_CLOUD_LOCATION") ?? Env.get("VERTEX_LOCATION") ?? "global"
    const autoload = Boolean(project)
    if (!autoload) return { autoload: false }
    return {
      autoload: true,
      options: {
        project,
        location,
      },
      async getModel(sdk: any, modelID) {
        const id = String(modelID).trim()
        return sdk.languageModel(id)
      },
    }
  },
  "sap-ai-core": async () => {
    const auth = await Auth.get("sap-ai-core")
    const envServiceKey = iife(() => {
      const envAICoreServiceKey = Env.get("AICORE_SERVICE_KEY")
      if (envAICoreServiceKey) return envAICoreServiceKey
      if (auth?.type === "api") {
        Env.set("AICORE_SERVICE_KEY", auth.key)
        return auth.key
      }
      return undefined
    })
    const deploymentId = Env.get("AICORE_DEPLOYMENT_ID")
    const resourceGroup = Env.get("AICORE_RESOURCE_GROUP")

    return {
      autoload: !!envServiceKey,
      options: envServiceKey ? { deploymentId, resourceGroup } : {},
      async getModel(sdk: any, modelID: string) {
        return sdk(modelID)
      },
    }
  },
  zenmux: async () => {
    return {
      autoload: false,
      options: {
        headers: {
          "HTTP-Referer": "https://atomcli.ai/",
          "X-Title": "atomcli",
        },
      },
    }
  },
  "cloudflare-ai-gateway": async (input) => {
    const accountId = Env.get("CLOUDFLARE_ACCOUNT_ID")
    const gateway = Env.get("CLOUDFLARE_GATEWAY_ID")

    if (!accountId || !gateway) return { autoload: false }

    // Get API token from env or auth prompt
    const apiToken = await (async () => {
      const envToken = Env.get("CLOUDFLARE_API_TOKEN")
      if (envToken) return envToken
      const auth = await Auth.get(input.id)
      if (auth?.type === "api") return auth.key
      return undefined
    })()

    return {
      autoload: true,
      async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
        return sdk.languageModel(modelID)
      },
      options: {
        baseURL: `https://gateway.ai.cloudflare.com/v1/${accountId}/${gateway}/compat`,
        headers: {
          // Cloudflare AI Gateway uses cf-aig-authorization for authenticated gateways
          // This enables Unified Billing where Cloudflare handles upstream provider auth
          ...(apiToken ? { "cf-aig-authorization": `Bearer ${apiToken}` } : {}),
          "HTTP-Referer": "https://atomcli.ai/",
          "X-Title": "atomcli",
        },
        // Custom fetch to strip Authorization header - AI Gateway uses cf-aig-authorization instead
        // Sending Authorization header with invalid value causes auth errors
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const headers = new Headers(init?.headers)
          headers.delete("Authorization")
          return fetch(input, { ...init, headers })
        },
      },
    }
  },
  cerebras: async () => {
    return {
      autoload: false,
      options: {
        headers: {
          "X-Cerebras-3rd-Party-Integration": "atomcli",
        },
      },
    }
  },
  // Kilocode - Cloud provider with device auth
  kilocode: async () => {
    const { available, token, organizationId } = await detectKilocode()
    if (!available || !token) {
      return { autoload: false }
    }

    // Fetch models dynamically from Kilocode API
    const kilocodeModels = await getKilocodeModels(token)
    const models: Record<string, Model> = {}

    for (const [id, info] of Object.entries(kilocodeModels)) {
      const supportsImages = Boolean(info.supportsImages)
      models[id] = {
        id,
        providerID: "kilocode",
        api: {
          id,
          npm: "@atomcli/kilocode",
          url: "https://api.kilo.ai/api/openrouter/",
        },
        name: info.name || id,
        family: id.split("/")[0],
        status: "active",
        capabilities: {
          temperature: true,
          reasoning: Boolean(info.supportsReasoning),
          attachment: supportsImages,
          toolcall: true,
          input: {
            text: true,
            audio: false,
            image: supportsImages,
            video: false,
            pdf: false,
          },
          output: {
            text: true,
            audio: false,
            image: false,
            video: false,
            pdf: false,
          },
          interleaved: false,
        },
        limit: {
          context: info.contextWindow || 128000,
          output: info.maxTokens || 8192,
        },
        cost: {
          input: info.inputPrice || 0,
          output: info.outputPrice || 0,
          cache: { read: 0, write: 0 },
        },
        options: {},
        headers: {},
        release_date: "",
        variants: {},
      }
    }

    return {
      autoload: Object.keys(models).length > 0,
      models,
      options: {
        apiKey: token,
        organizationId,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    }
  },
}
