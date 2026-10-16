import { Instance } from "@/services/project/instance"
import { Session } from "@/core/session"
import { SessionStatus } from "@/core/session/status"
import { Provider } from "@/integrations/provider/provider"
import { Agent } from "@/integrations/agent/agent"
import { Config } from "@/core/config/config"
import { knownDirectories } from "./directory"
import { Log } from "@/util/util/log"

const log = Log.create({ service: "companion-ws.messages" })
function diagnosticError(error: unknown) {
  return error instanceof Error ? { name: error.name.slice(0, 64) } : { kind: typeof error }
}

export async function sendSessionList(ws: any, currentDirectory = Instance.directory) {
  try {
    const sessions = new Map<
      string,
      { id: string; title: string; updated: number; directory: string; status: string }
    >()
    for (const directory of await knownDirectories(currentDirectory)) {
      await Instance.provide({
        directory,
        fn: async () => {
          for await (const s of Session.list()) {
            sessions.set(s.id, {
              id: s.id,
              title: s.title,
              updated: s.time.updated,
              directory: s.directory,
              status: SessionStatus.get(s.id).type,
            })
          }
        },
      })
    }
    const sorted = Array.from(sessions.values()).sort((a, b) => b.updated - a.updated)
    ws.send(JSON.stringify({ type: "session_list", sessions: sorted, current_directory: currentDirectory }))
  } catch (err) {
    log.error("failed to send session list", { error: diagnosticError(err) })
  }
}

export async function sendModelList(ws: any) {
  try {
    const connected = await Provider.list()
    const models = []
    for (const [providerId, provider] of Object.entries(connected)) {
      for (const [modelId, model] of Object.entries(provider.models)) {
        models.push({
          id: `${providerId}/${modelId}`,
          name: model.name,
          providerId,
          providerName: provider.name,
          family: model.family,
          status: model.status,
          free: model.cost.input === 0 && model.cost.output === 0,
          cost: { input: model.cost.input, output: model.cost.output },
          limit: { context: model.limit.context, output: model.limit.output },
          reasoning: model.capabilities.reasoning,
          capabilities: {
            tools: model.capabilities.toolcall,
            images: model.capabilities.input.image,
            pdf: model.capabilities.input.pdf,
            audio: model.capabilities.input.audio,
            video: model.capabilities.input.video,
          },
          variants: Object.keys(model.variants ?? {}),
        })
      }
    }
    models.sort((a, b) => {
      if (a.providerId === "atomcli" && b.providerId !== "atomcli") return -1
      if (b.providerId === "atomcli" && a.providerId !== "atomcli") return 1
      if (a.providerName !== b.providerName) return a.providerName.localeCompare(b.providerName)
      if (a.free !== b.free) return a.free ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    // Resolve the server-configured default model so mobile can pre-select it
    let default_model: string | undefined
    try {
      const cfg = await Config.get()
      default_model = cfg.model ?? undefined
    } catch {
      /* non-fatal */
    }

    ws.send(JSON.stringify({ type: "models_list", models, default_model }))
  } catch (err) {
    log.error("failed to send model list", { error: diagnosticError(err) })
  }
}

export async function sendAgentList(ws: any) {
  try {
    const agents = await Agent.list()
    const agentInfos = agents.map((a) => ({
      name: a.name,
      description: a.description,
      mode: a.mode,
      hidden: a.hidden,
    }))
    ws.send(JSON.stringify({ type: "agents_list", agents: agentInfos }))
  } catch (err) {
    log.error("failed to send agent list", { error: diagnosticError(err) })
  }
}
