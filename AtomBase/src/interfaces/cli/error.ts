import { ConfigMarkdown } from "@/core/config/markdown"
import { Config } from "@/core/config/config"
import { MCP } from "@/integrations/mcp"
import { Provider } from "@/integrations/provider/provider"
import { UI } from "./ui"

export function handleNamedError(input: unknown): string | null {
  if (typeof input === "object" && input !== null && "name" in input && typeof input.name === "string") {
    // Cast to any to access data safely since TS loses context across unions.
    const err = input as any
    const data = err.data || {}

    if (input.name === "MCP_SERVER_FAILED") {
      return `MCP server "${data.name}" failed. Note, atomcli does not support MCP authentication yet.`
    }
    if (input.name === "BAD_CREDENTIAL") {
      const { providerID, modelID, suggestions } = data
      const extra = suggestions ? ` (Did you mean: ${suggestions.join(", ")})` : ""
      return `Failed to initialize (${providerID}${modelID ? `/${modelID}` : ""}): Invalid Credentials${extra}`
    }
    if (input.name === "MODEL_NOT_FOUND") {
      const { providerID, modelID, suggestions } = data
      return [
        `Model not found: ${providerID}/${modelID}`,
        ...(Array.isArray(suggestions) && suggestions.length ? ["Did you mean: " + suggestions.join(", ")] : []),
        `Try: \`atomcli models\` to list available models`,
        `Or check your config (atomcli.json) provider/model names`,
      ].join("\n")
    }
    if (input.name === "PROVIDER_INIT_ERROR") {
      return `Failed to initialize provider "${data.providerID}". Check credentials and configuration.`
    }
  }
  return null
}

export function FormatError(input: unknown) {
  const namedError = handleNamedError(input)
  if (namedError !== null) {
    return namedError
  }

  if (MCP.Failed.isInstance(input))
    return `MCP server "${(input as any).data?.name}" failed. Note, atomcli does not support MCP authentication yet.`
  if (Provider.ModelNotFoundError.isInstance(input)) {
    const { providerID, modelID, suggestions } = (input as any).data
    return [
      `Model not found: ${providerID}/${modelID}`,
      ...(Array.isArray(suggestions) && suggestions.length ? ["Did you mean: " + suggestions.join(", ")] : []),
      `Try: \`atomcli models\` to list available models`,
      `Or check your config (atomcli.json) provider/model names`,
    ].join("\n")
  }
  if (Provider.InitError.isInstance(input)) {
    return `Failed to initialize provider "${(input as any).data.providerID}". Check credentials and configuration.`
  }
  if (Config.JsonError.isInstance(input)) {
    return (
      `Config file at ${(input as any).data.path} is not valid JSON(C)` + ((input as any).data.message ? `: ${(input as any).data.message}` : "")
    )
  }
  if (Config.ConfigDirectoryTypoError.isInstance(input)) {
    return `Directory "${(input as any).data.dir}" in ${(input as any).data.path} is not valid. Rename the directory to "${(input as any).data.suggestion}" or remove it. This is a common typo.`
  }
  if (ConfigMarkdown.FrontmatterError.isInstance(input)) {
    return `Failed to parse frontmatter in ${(input as any).data.path}:\n${(input as any).data.message}`
  }
  if (Config.InvalidError.isInstance(input))
    return [
      `Configuration is invalid${(input as any).data.path && (input as any).data.path !== "config" ? ` at ${(input as any).data.path}` : ""}` +
      ((input as any).data.message ? `: ${(input as any).data.message}` : ""),
      ...((input as any).data.issues?.map((issue) => "↳ " + issue.message + " " + issue.path.join(".")) ?? []),
    ].join("\n")

  if (UI.CancelledError.isInstance(input)) return ""
}

export function FormatUnknownError(input: unknown): string {
  if (input instanceof Error) {
    return input.stack ?? `${input.name}: ${input.message}`
  }

  if (typeof input === "object" && input !== null) {
    try {
      return JSON.stringify(input, null, 2)
    } catch {
      return "Unexpected error (unserializable)"
    }
  }

  return String(input)
}
