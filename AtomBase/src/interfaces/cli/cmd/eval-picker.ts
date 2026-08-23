import * as prompts from "@clack/prompts"
import { Agent } from "@/integrations/agent/agent"
import { Provider } from "@/integrations/provider/provider"

export namespace EvalPicker {
  export interface Selection {
    model: { providerID: string; modelID: string }
    agent: string
  }

  /** Interactive selection only makes sense on a real terminal. */
  export function enabled() {
    return Boolean(process.stdin.isTTY && process.stdout.isTTY)
  }

  async function pick(message: string, options: { value: string; label: string; hint?: string }[]): Promise<string> {
    const result = await prompts.select<string>({
      message,
      options,
      maxItems: 18,
    })
    if (prompts.isCancel(result)) throw new Error("benchmark selection cancelled")
    return result
  }

  export async function select(): Promise<Selection> {
    prompts.intro("AtomCLI benchmark")

    const providers = Object.values(await Provider.list())
      .filter((provider) => Object.keys(provider.models ?? {}).length > 0)
      .sort((a, b) => a.name.localeCompare(b.name))
    if (providers.length === 0) throw new Error("no authenticated providers with models found")
    prompts.log.message(`${providers.length} provider(s) available`)

    const providerID = await pick(
      "Provider",
      providers.map((provider) => ({
        value: provider.id,
        label: provider.name,
        hint: `${Object.keys(provider.models).length} models`,
      })),
    )
    const provider = providers.find((candidate) => candidate.id === providerID)!

    const modelID = await pick(
      `Model (${provider.name})`,
      Object.values(provider.models)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((model) => ({
          value: model.id,
          label: model.name,
          hint: model.id === model.name ? undefined : model.id,
        })),
    )

    const agents = (await Agent.list()).filter((agent) => agent.mode !== "subagent" && !agent.hidden)
    const known = new Set(agents.map((agent) => agent.name))
    const agentOptions = [
      ...(known.has("build") ? [] : [{ value: "build", label: "build", hint: "native coding agent" }]),
      ...agents.map((agent) => ({
        value: agent.name,
        label: agent.name,
        hint: agent.description,
      })),
    ]
    const agent = await pick("Agent that executes the cases", agentOptions)

    prompts.outro(`Selected ${providerID}/${modelID} with agent "${agent}"`)
    return { model: Provider.parseModel(`${providerID}/${modelID}`), agent }
  }
}
