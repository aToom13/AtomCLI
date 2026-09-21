import z from "zod"
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
      maxRetries: 0,
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
    packagesTouched?: string[]
    failureCount?: number
    mutatingCalls?: number
    externalCalls?: number
    toolCalls?: number
    successfulToolCalls?: number
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
    requiresReview: boolean
    requiresChecker: boolean
    allowedTools?: string[]
    promotionReasons: string[]
    budgetExtension?: {
      count: number
      progress: number
      failures: number
      reasons: string[]
    }
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
  ): string[] | undefined {
    if (scope === "coordinated") return undefined // all permitted tools
    if (scope === "direct") {
      if (intent === "answer") return []
      if (intent === "inspect") return ["read", "grep", "find"]
      return ["read", "edit", "write"]
    }
    return ["read", "edit", "write", "grep", "find", "bash", "lsp", "websearch", "webfetch", "taskflow"]
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
    const requiresReview = risk === "critical" || (risk === "elevated" && scope === "coordinated")
    const requiresChecker = risk === "critical" && (evidence?.hasAuthOrSecurityEffect ?? false)
    const allowedTools = selectAllowedTools(scope, contract.intent)

    return {
      scope,
      risk,
      budget,
      requiresReview,
      requiresChecker,
      allowedTools,
      promotionReasons: [...new Set(promotionReasons)],
      budgetExtension: priorPolicy?.budgetExtension,
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
      if (e.hasPublicApiEffect) {
        targetScope = "coordinated"
        reasons.push("Public API surface modified")
      }
      if (e.hasSchemaOrMigrationEffect) {
        targetScope = "coordinated"
        reasons.push("Persistent schema or migration modified")
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
      reasons.push("Critical security, schema, public API, or destructive action identified")
    }

    return {
      newScope: targetScope !== input.currentScope ? targetScope : undefined,
      newRisk: targetRisk !== input.currentRisk ? targetRisk : undefined,
      reasons,
    }
  }
}
