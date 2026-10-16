export type RouteGuidance = {
  routeRevised: boolean
  selfCritique: string
  failedApproaches: string[]
  whatToChanges: string[]
  consecutiveRevisions: number
  updatedAt: number
}

const MAX_ENTRIES = 500
const TTL_MS = 60 * 60 * 1000
const entries = new Map<string, RouteGuidance>()

export function get(executionID: string) {
  return entries.get(executionID)
}

export function restore(
  executionID: string,
  checkpoints: Array<{
    payload?: {
      checkpoint?: {
        routeDecision?: unknown
        selfCritique?: unknown
        failedApproaches?: unknown
        whatToChanges?: unknown
      }
    }
    createdAt?: number
  }>,
) {
  let guidance: RouteGuidance | undefined
  for (const record of checkpoints) {
    const checkpoint = record.payload?.checkpoint
    if (checkpoint?.routeDecision !== "revise" && checkpoint?.routeDecision !== "keep") continue
    const revised = checkpoint.routeDecision === "revise"
    const failures = Array.isArray(checkpoint.failedApproaches)
      ? checkpoint.failedApproaches.filter((value): value is string => typeof value === "string")
      : []
    const changes = Array.isArray(checkpoint.whatToChanges)
      ? checkpoint.whatToChanges.filter((value): value is string => typeof value === "string")
      : []
    guidance = {
      routeRevised: revised,
      selfCritique:
        typeof checkpoint.selfCritique === "string" ? checkpoint.selfCritique : (guidance?.selfCritique ?? ""),
      failedApproaches: [...new Set([...(guidance?.failedApproaches ?? []), ...failures])].slice(-50),
      whatToChanges: revised ? changes : (guidance?.whatToChanges ?? []),
      consecutiveRevisions: revised ? (guidance?.consecutiveRevisions ?? 0) + 1 : 0,
      updatedAt: record.createdAt ?? Date.now(),
    }
  }
  if (guidance) {
    entries.set(executionID, guidance)
    prune()
  } else entries.delete(executionID)
  return guidance
}

export function set(executionID: string, guidance: RouteGuidance) {
  entries.set(executionID, guidance)
}

export function prune(now = Date.now(), isTerminal: (executionID: string) => boolean = () => false) {
  let evicted = 0
  for (const [executionID, entry] of entries) {
    if (now - entry.updatedAt >= TTL_MS) {
      entries.delete(executionID)
      evicted++
    }
  }
  if (entries.size <= MAX_ENTRIES) return evicted
  for (const [executionID] of entries) {
    if (entries.size <= MAX_ENTRIES) break
    if (isTerminal(executionID)) {
      entries.delete(executionID)
      evicted++
    }
  }
  if (entries.size <= MAX_ENTRIES) return evicted
  for (const [executionID] of [...entries.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)) {
    if (entries.size <= MAX_ENTRIES) break
    entries.delete(executionID)
    evicted++
  }
  return evicted
}

export function seed(executionID: string, updatedAt: number) {
  entries.set(executionID, {
    routeRevised: true,
    selfCritique: "seeded",
    failedApproaches: [],
    whatToChanges: [],
    consecutiveRevisions: 0,
    updatedAt,
  })
}

export const limits = { maxEntries: MAX_ENTRIES, ttlMs: TTL_MS }
