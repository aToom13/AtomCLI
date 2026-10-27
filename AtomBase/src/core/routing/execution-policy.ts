import { ExecutionContract } from "./execution-contract"

export namespace ExecutionPolicy {
  export interface Budget {
    maxSteps: number
    maxToolCalls: number
    maxRetries: number
    allowTaskflow: boolean
    allowSubagents: boolean
    allowExpertRouting: boolean | "on_failure"
    allowMemoryRecall: boolean | "targeted"
    allowSummary: boolean
  }

  export const BUDGETS: Record<ExecutionContract.Scope, Budget> = {
    direct: {
      maxSteps: 2,
      maxToolCalls: 3,
      maxRetries: 1,
      allowTaskflow: false,
      allowSubagents: false,
      allowExpertRouting: false,
      allowMemoryRecall: false,
      allowSummary: false,
    },
    focused: {
      maxSteps: 6,
      maxToolCalls: 10,
      maxRetries: 1,
      allowTaskflow: true,
      allowSubagents: false,
      allowExpertRouting: "on_failure",
      allowMemoryRecall: "targeted",
      allowSummary: false,
    },
    coordinated: {
      maxSteps: 30,
      maxToolCalls: 30,
      maxRetries: 2,
      allowTaskflow: true,
      allowSubagents: true,
      allowExpertRouting: true,
      allowMemoryRecall: true,
      allowSummary: true,
    },
  }

  export const SCOPE_RANK: Record<ExecutionContract.Scope, number> = {
    direct: 0,
    focused: 1,
    coordinated: 2,
  }

  export const RISK_RANK: Record<ExecutionContract.Risk, number> = {
    low: 0,
    elevated: 1,
    critical: 2,
  }

  export interface RuntimeEvidence {
    filesRead?: string[]
    filesChanged?: string[]
    // CP-02: per-path successful write counts. Cumulative growth distinguishes
    // "same file, new revision" from list-length noise.
    fileWriteCounts?: Record<string, number>
    packagesTouched?: string[]
    failureCount?: number
    mutatingCalls?: number
    externalCalls?: number
    toolCalls?: number
    successfulToolCalls?: number
    browserNavigations?: number
    browserVerificationCalls?: number
    browserAccessibilityCalls?: number
    browserNetworkCalls?: number
    browserSourceMutations?: number
    recentToolCallSignatures?: string[]
    recentToolFamilies?: string[]
    recentToolTargets?: string[]
    recentSemanticActionResults?: string[]
    recentErrorFingerprints?: string[]
    noProgressSlices?: number
    hasAuthOrSecurityEffect?: boolean
    hasSchemaOrMigrationEffect?: boolean
    hasPublicApiEffect?: boolean
    hasDestructiveAction?: boolean
    subtasksSpawned?: number
    uncertainOutcome?: boolean
  }

  export interface PolicyInfo {
    scope: ExecutionContract.Scope
    risk: ExecutionContract.Risk
    budget: Budget
    allowedTools?: string[]
    promotionReasons: string[]
    budgetExtension?: {
      count: number
      progress: number
      failures: number
      reasons: string[]
    }
    diagnostics?: string[]
  }

  export function detectContradictions(input: {
    contract: ExecutionContract.Info
    budget: Budget
    allowedTools?: string[]
  }): string[] {
    const diagnostics: string[] = []
    if (input.contract.scope !== "coordinated" && input.budget.allowSubagents)
      diagnostics.push("subagents_allowed_outside_coordinated_scope")
    if (input.contract.scope === "direct" && input.budget.allowTaskflow)
      diagnostics.push("taskflow_allowed_in_direct_scope")
    if (input.contract.needsMutation && input.allowedTools) {
      const hasMutationTool = input.allowedTools.includes("edit") || input.allowedTools.includes("write")
      if (!hasMutationTool) diagnostics.push("mutation_required_but_tools_exclude_edit_write")
    }
    return diagnostics
  }

  export function canPromoteScope(current: ExecutionContract.Scope, next: ExecutionContract.Scope): boolean {
    return SCOPE_RANK[next] > SCOPE_RANK[current]
  }

  export function canPromoteRisk(current: ExecutionContract.Risk, next: ExecutionContract.Risk): boolean {
    return RISK_RANK[next] > RISK_RANK[current]
  }

  export function selectAllowedTools(
    scope: ExecutionContract.Scope,
    intent: ExecutionContract.Intent,
    expectedSurfaces: ExecutionContract.Surface[] = [],
    needsMutation = intent === "change" || intent === "operate",
  ): string[] | undefined {
    const surfaceTools = new Set<string>()
    if (expectedSurfaces.includes("browser")) surfaceTools.add("browser")
    if (expectedSurfaces.includes("browser") || intent === "design") surfaceTools.add("skill")
    let baseTools: string[] = []
    if (scope === "direct") {
      // Keep a bounded read capability in the coding-agent request context.
      if (intent === "answer") {
        baseTools = ["read", ...surfaceTools]
      } else if (intent === "inspect") {
        baseTools = ["read", "grep", "find", ...surfaceTools]
      } else if (!needsMutation) {
        baseTools = ["read", "grep", "find", ...surfaceTools]
      } else {
        baseTools = ["read", "edit", "write", ...surfaceTools]
      }
    } else if (scope === "focused") {
      const common =
        intent === "answer" || intent === "inspect" || !needsMutation
          ? ["read", "grep", "find", "bash", "lsp", "websearch", "webfetch"]
          : ["read", "edit", "write", "grep", "find", "bash", "lsp", "websearch", "webfetch"]
      baseTools = [...common]
    } else {
      // scope === coordinated
      const common =
        intent === "answer" || intent === "inspect" || !needsMutation
          ? ["read", "grep", "find", "bash", "lsp", "websearch", "webfetch"]
          : ["read", "edit", "write", "grep", "find", "bash", "lsp", "websearch", "webfetch"]
      baseTools = [...common]
      // Coordinated is the only scope where the model-facing coordination
      // surface is offered: a visible checklist (todo) plus delegation (agent).
      // taskflow/orchestrate/normal-task stay out of the advertised set; they
      // remain internal execution/state mechanisms reachable via compatibility.
      baseTools.push("todo")
      baseTools.push("agent")
    }
    if (scope !== "direct") baseTools.push("static_check")
    // Add surface tools (browser, skill) if not already present
    surfaceTools.forEach((t) => {
      if (!baseTools.includes(t)) baseTools.push(t)
    })
    return baseTools
  }
  export function resolvePolicy(
    contract: ExecutionContract.Info,
    evidence?: RuntimeEvidence,
    priorReasons: string[] = [],
    priorPolicy?: PolicyInfo,
  ): PolicyInfo {
    let scope = contract.scope
    let risk = contract.risk
    const promotionReasons = [...priorReasons]

    if (evidence) {
      const promotion = evaluatePromotion({ currentScope: scope, currentRisk: risk, evidence })
      if (promotion.newScope && canPromoteScope(scope, promotion.newScope)) {
        scope = promotion.newScope
      }
      if (promotion.newRisk && canPromoteRisk(risk, promotion.newRisk)) {
        risk = promotion.newRisk
      }
      promotionReasons.push(...promotion.reasons)
    }

    const budget = {
      ...BUDGETS[scope],
      maxSteps: Math.max(BUDGETS[scope].maxSteps, priorPolicy?.budget.maxSteps ?? 0),
      maxToolCalls: Math.max(BUDGETS[scope].maxToolCalls, priorPolicy?.budget.maxToolCalls ?? 0),
    }
    const allowedTools = selectAllowedTools(scope, contract.intent, contract.expectedSurfaces, contract.needsMutation)
    const diagnostics = detectContradictions({ contract: { ...contract, scope, risk }, budget, allowedTools })

    return {
      scope,
      risk,
      budget,
      allowedTools,
      promotionReasons: [...new Set(promotionReasons)],
      budgetExtension: priorPolicy?.budgetExtension,
      diagnostics,
    }
  }

  export function evaluatePromotion(input: {
    currentScope: ExecutionContract.Scope
    currentRisk: ExecutionContract.Risk
    evidence: RuntimeEvidence
  }): {
    newScope?: ExecutionContract.Scope
    newRisk?: ExecutionContract.Risk
    reasons: string[]
  } {
    const reasons: string[] = []
    let targetScope = input.currentScope
    let targetRisk = input.currentRisk
    const e = input.evidence

    // Scope promotion: direct -> focused
    if (input.currentScope === "direct") {
      if ((e.filesRead?.length ?? 0) > 1) {
        targetScope = "focused"
        reasons.push("Multiple files read required")
      }
      if ((e.filesChanged?.length ?? 0) > 0) {
        targetScope = "focused"
        reasons.push("File mutation detected in direct scope")
      }
      if ((e.failureCount ?? 0) > 0) {
        targetScope = "focused"
        reasons.push("Strategy failure occurred in direct scope")
      }
      if (e.uncertainOutcome) {
        targetScope = "focused"
        reasons.push("Uncertain tool outcome in direct scope")
      }
    }

    // Scope promotion: direct/focused -> coordinated
    if (targetScope !== "coordinated") {
      if ((e.packagesTouched?.length ?? 0) >= 2) {
        targetScope = "coordinated"
        reasons.push("Cross-package boundary touched")
      }
      if ((e.filesChanged?.length ?? 0) > 4) {
        targetScope = "coordinated"
        reasons.push("Wide change affecting more than 4 files")
      }
      if ((e.failureCount ?? 0) >= 2) {
        targetScope = "coordinated"
        reasons.push("Repeated failure requires multi-strategy coordination")
      }
      if ((e.subtasksSpawned ?? 0) > 0) {
        targetScope = "coordinated"
        reasons.push("Independent subtasks required")
      }
    }

    // Risk promotion
    if ((e.mutatingCalls ?? 0) > 0 && targetRisk === "low") {
      targetRisk = "elevated"
      reasons.push("Mutating tool execution")
    }
    if ((e.externalCalls ?? 0) > 0 && targetRisk === "low") {
      targetRisk = "elevated"
      reasons.push("External side-effect detected")
    }
    if (e.hasAuthOrSecurityEffect || e.hasSchemaOrMigrationEffect || e.hasPublicApiEffect || e.hasDestructiveAction) {
      targetRisk = "critical"
      if (e.hasPublicApiEffect) reasons.push("Public API surface modified")
      if (e.hasSchemaOrMigrationEffect) reasons.push("Persistent schema or migration modified")
      reasons.push("Critical security, schema, public API, or destructive action identified")
    }

    return {
      newScope: targetScope !== input.currentScope ? targetScope : undefined,
      newRisk: targetRisk !== input.currentRisk ? targetRisk : undefined,
      reasons,
    }
  }
}
