import type { CustomLoader } from "../types"
import * as anthropic from "./anthropic"
import * as openai from "./openai"
import * as google from "./google"
import * as bedrock from "./bedrock"
import * as ollama from "./ollama"
import * as misc from "./misc"

export const CUSTOM_LOADERS: Record<string, CustomLoader> = {
    anthropic: anthropic.anthropic,
    atomcli: anthropic.atomcli,
    ollama: ollama.ollama,
    openai: openai.openai,
    "github-copilot": openai.githubCopilot,
    "github-copilot-enterprise": openai.githubCopilotEnterprise,
    azure: openai.azure,
    "azure-cognitive-services": openai.azureCognitiveServices,
    "amazon-bedrock": bedrock.amazonBedrock,
    openrouter: misc.openrouter,
    vercel: misc.vercel,
    "google-vertex": google.googleVertex,
    "google-vertex-anthropic": google.googleVertexAnthropic,
    "sap-ai-core": misc.sapAiCore,
    zenmux: misc.zenmux,
    "cloudflare-ai-gateway": misc.cloudflareAiGateway,
    cerebras: misc.cerebras,
}
