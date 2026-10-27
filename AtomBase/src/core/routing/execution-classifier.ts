import { ExecutionContract } from "./execution-contract"
import { TaskProfile } from "./task-profile"

export namespace ExecutionClassifier {
  const cache = new Map<string, ExecutionContract.Info>()
  const MAX_CACHE_SIZE = 200

  export interface Input {
    invocationID?: string
    prompt: string
    agentMode?: string
    explicitOrchestration?: boolean
    scopeFloor?: ExecutionContract.Scope
  }

  export interface ClassificationResult {
    contract: ExecutionContract.Info
    durationMs: number
    cached: boolean
    fallback: boolean
  }

  const WORKSPACE_MENTION = /\b(?:repo|repository|project|file|code|workspace)\b|proje|dosya|kod|depo/i
  const SIMPLE_EXPLANATION = /^(?:please\s+)?(?:what is|what's|explain|define|nedir|açıkla)(?=\s|\?|$)/i
  const COMPLEX_TOPIC =
    /\b(?:game|browser|app|application|architecture|design|3d|complete|full|system)\b|oyun|uygulama|tasarım|mimari/i

  function fastPath(input: Input): ExecutionContract.Info | undefined {
    const prompt = input.prompt.trim().toLowerCase()
    if (!prompt || input.explicitOrchestration || input.scopeFloor === "coordinated") return undefined

    if (/^(hi|hello|hey|selam|merhaba|thanks|thank you|teşekkürler)[!.\s]*$/.test(prompt)) {
      return ExecutionContract.parseSafe({
        intent: "answer",
        scope: "direct",
        risk: "low",
        confidence: 0.99,
        expectedSurfaces: ["conversation"],
        rationale: "deterministic conversational fast path",
      })
    }

    if (
      prompt.length <= 80 &&
      SIMPLE_EXPLANATION.test(prompt) &&
      TaskProfile.isReadOnly(prompt) &&
      !WORKSPACE_MENTION.test(prompt) &&
      !COMPLEX_TOPIC.test(prompt)
    ) {
      return ExecutionContract.parseSafe({
        intent: "answer",
        scope: "direct",
        risk: "low",
        confidence: 0.9,
        expectedSurfaces: ["conversation"],
        rationale: "deterministic simple explanation fast path",
      })
    }

    return undefined
  }

  function localContract(prompt: string): ExecutionContract.Info {
    const profile = TaskProfile.infer(prompt)
    const workspace = WORKSPACE_MENTION.test(prompt)
    const readOnly = profile.readOnly
    return enforceComplexity(
      prompt,
      ExecutionContract.parseSafe({
        intent: readOnly ? (workspace ? "inspect" : "answer") : "change",
        scope: readOnly ? (workspace ? "focused" : "direct") : profile.longContext ? "coordinated" : "focused",
        risk: profile.risk,
        confidence: 0.6,
        expectedSurfaces: readOnly && !workspace ? ["conversation"] : ["workspace"],
        needsDiscovery: workspace || !readOnly,
        needsMutation: !readOnly,
        rationale: "deterministic task profile; runtime evidence may promote scope and risk",
      }),
    )
  }

  /**
   * Keep broad build requests from being under-scoped when the classifier
   * returns an optimistic focused contract. These tasks need room for
   * implementation, runtime verification, and independent QA.
   */
  export function enforceComplexity(prompt: string, contract: ExecutionContract.Info): ExecutionContract.Info {
    const text = prompt.toLowerCase()
    const acceptance = ExecutionContract.acceptanceFor(prompt)
    contract = {
      ...contract,
      acceptance: contract.intent === "answer" ? undefined : acceptance.length ? acceptance : contract.acceptance,
      acceptanceRevision: undefined,
      acceptanceChange: undefined,
    }
    if (
      contract.intent !== "answer" &&
      /\b(?:run|execute)\s+(?:the\s+)?(?:bash|shell)\s+command\b|(?:bash|shell)\s+komutunu\s+çalıştır/i.test(prompt)
    ) {
      contract = {
        ...contract,
        scope: contract.scope === "direct" ? "focused" : contract.scope,
        expectedSurfaces: [...new Set([...contract.expectedSurfaces, "system" as const])],
      }
    }
    // ponytail: explicit operation names select the surface; extend names only for supported operations.
    if (
      contract.intent !== "answer" &&
      /\b(?:browser (?:tool|flows?|navigation|verification)|chromium|playwright|input_sequence)\b|tarayıcı aracı/.test(
        text,
      )
    ) {
      contract = {
        ...contract,
        scope: contract.scope === "direct" ? "focused" : contract.scope,
        expectedSurfaces: [...new Set([...contract.expectedSurfaces, "browser" as const])],
        needsExternalAction: true,
      }
    }
    if (TaskProfile.isReadOnly(text)) return contract
    const browser = /\b(?:browser|chrome|html|css|javascript|web\s*(?:app|os|desktop|game)|playwright)\b|tarayıcı/.test(
      text,
    )
    const game = /\b(?:game|gameplay|skateboard|skateboarding|gta|3d|physics|playable|trick|npc|camera)\b|oyun/.test(
      text,
    )
    const multiSurface =
      /\b(?:at\s+least\s+\d+|multiple|five|six|complete|full|self-contained|single[- ]file|compile\s+and\s+run|no\s+setup)\b|en\s+az\s+\d+|birden\s+fazla|tek\s+dosya/.test(
        text,
      )
    const complex =
      (game && multiSurface) ||
      (browser && multiSurface && /\b(?:app|application|os|desktop|game)\b|uygulama|masaüstü|oyun/.test(text))
    if (!complex) return contract
    const expectedSurfaces = [
      ...new Set([...(contract.expectedSurfaces ?? []), ...(browser ? ["browser" as const] : ["workspace" as const])]),
    ]
    return {
      ...contract,
      scope: "coordinated",
      risk: contract.risk === "critical" ? "critical" : "elevated",
      expectedSurfaces,
      needsDiscovery: true,
      needsMutation: true,
      rationale:
        `${contract.rationale}; complex interactive deliverable requires coordinated build and independent verification`.slice(
          0,
          500,
        ),
    }
  }

  function setCache(key: string, contract: ExecutionContract.Info) {
    if (cache.size >= MAX_CACHE_SIZE) {
      const first = cache.keys().next().value
      if (first !== undefined) cache.delete(first)
    }
    cache.set(key, contract)
  }

  export function clearCache() {
    cache.clear()
  }

  export async function classify(input: Input): Promise<ClassificationResult> {
    const started = Date.now()
    const cacheKey = [
      input.invocationID ?? input.prompt.trim(),
      `floor=${input.scopeFloor ?? "none"}`,
      `explicit=${input.explicitOrchestration === true ? "yes" : "no"}`,
      `agent=${input.agentMode ?? "default"}`,
    ].join("|")

    if (cacheKey) {
      const cached = cache.get(cacheKey)
      if (cached) {
        return {
          contract: cached,
          durationMs: Date.now() - started,
          cached: true,
          fallback: false,
        }
      }
    }

    const contract = fastPath(input) ?? localContract(input.prompt)
    const floor = input.scopeFloor ?? (input.explicitOrchestration ? "focused" : "direct")
    if (ExecutionContract.SCOPE_RANK[floor] > ExecutionContract.SCOPE_RANK[contract.scope]) contract.scope = floor
    setCache(cacheKey, contract)
    return { contract, durationMs: Date.now() - started, cached: false, fallback: false }
  }
}
