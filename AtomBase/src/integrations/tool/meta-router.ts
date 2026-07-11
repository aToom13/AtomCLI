import { Provider } from "../provider/provider"
import { selectCandidates } from "./model-router"

/**
 * Selects the best reasoning and toolcall capable model to serve as the Meta-Router (Plan/Coordination).
 */
export function selectMetaRouter(freeModels: Array<[string, Provider.Model]>): { providerID: string; modelID: string } {
  const activeMr = freeModels
    .filter(([, m]) => m.capabilities.reasoning && m.capabilities.toolcall && m.status === "active")
    .map(([id, m]) => ({
      id,
      score: 100 
           + Math.min((m.limit?.context ?? 0) / 10000, 30) 
           + Math.min((m.limit?.output ?? 0) / 1000, 20)
    }))
    .sort((a, b) => b.score - a.score)
    
  if (activeMr.length === 0) {
    // Eşiği düşür: reasoning veya toolcall'dan en az birine sahip active modelleri kabul et
    const fallbackMr = freeModels
      .filter(([, m]) => (m.capabilities.reasoning || m.capabilities.toolcall) && m.status === "active")
      .map(([id, m]) => ({
        id,
        score: (m.capabilities.reasoning ? 50 : 0) + (m.capabilities.toolcall ? 50 : 0)
      }))
      .sort((a, b) => b.score - a.score)
      
    if (fallbackMr.length > 0) {
      return { providerID: "atomcli", modelID: fallbackMr[0].id }
    }
    // En kötü ihtimalle Degradation Ladder ile en üstteki modeli dön
    return { providerID: "atomcli", modelID: selectCandidates(freeModels, "general")[0][0] }
  }
  
  return { providerID: "atomcli", modelID: activeMr[0].id }
}
