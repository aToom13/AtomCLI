import { Global } from "@/core/global"
import path from "path"
import fs from "fs/promises"

export interface RoutingDecision {
  ts: number
  category: string
  mode: string
  selected: string
  score: number
  candidates: Array<{ id: string; score: number }>
  estimatedRequiredContext?: number
  sessionID?: string
}

export async function appendRoutingLog(decision: RoutingDecision): Promise<void> {
  try {
    const dir = Global.Path.state
    await fs.mkdir(dir, { recursive: true }).catch(() => {})
    const logFile = path.join(dir, "auto-routing.jsonl")
    const line = JSON.stringify(decision) + "\n"
    await fs.appendFile(logFile, line, "utf-8")
  } catch (e) {
    // Silently ignore logging failures to prevent disrupting LLM inference
  }
}
