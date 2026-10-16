import { PermissionNext } from "@/util/permission/next"
import { Question } from "@/interfaces/question"
import { Session } from "@/core/session"
import { ExecutionRuntime } from "@/core/execution/runtime"
import { Instance } from "@/services/project/instance"
import { MobileBridge, type RecentCheckpoint } from "@atomcli/companion"
import { knownDirectories } from "./directory"

export async function sendBridgeSnapshot(clientId: string) {
  const permissions = []
  const questions = []
  const routeProposals = []
  const activeRoutes = []
  const recentCheckpoints: RecentCheckpoint[] = []
  for (const directory of await knownDirectories(Instance.directory)) {
    await Instance.provide({
      directory,
      fn: async () => {
        permissions.push(
          ...(await PermissionNext.list()).map((permission) => ({
            req_id: permission.id,
            sessionID: permission.sessionID,
            permission: permission.permission,
            patterns: permission.patterns,
            always: permission.always,
            directory,
            metadata: permission.metadata,
          })),
        )
        questions.push(
          ...(await Question.list()).map((question) => ({
            req_id: question.id,
            sessionID: question.sessionID,
            directory,
            questions: question.questions,
            tool: question.tool,
          })),
        )
        for await (const session of Session.list()) {
          const snapshot = await Promise.resolve(ExecutionRuntime.snapshot(session.id)).catch(() => undefined)
          if (!snapshot) continue
          routeProposals.push(
            ...snapshot.pendingProposals.map((proposal) => ({ ...proposal, sessionID: session.id, directory })),
          )
          activeRoutes.push(
            ...snapshot.executions.flatMap((execution) =>
              execution.id === snapshot.activeExecutionID && execution.route
                ? [
                    {
                      sessionID: execution.rootSessionID,
                      executionID: execution.id,
                      routeRevision: execution.routeRevision,
                      directory,
                      ...execution.route,
                    },
                  ]
                : [],
            ),
          )
          if (snapshot.activeExecutionID) {
            const latest = ExecutionRuntime.checkpoints(snapshot.activeExecutionID).at(-1)
            if (latest) {
              const payload = (latest.payload ?? {}) as {
                checkpoint?: Record<string, unknown>
                telemetry?: Record<string, unknown>
                triggerMessageID?: string
              }
              const checkpoint = payload.checkpoint ?? {}
              recentCheckpoints.push({
                directory,
                sessionID: session.id,
                executionID: snapshot.activeExecutionID,
                part: {
                  id: `snapshot:checkpoint:${snapshot.activeExecutionID}:${latest.sequence}`,
                  sessionID: session.id,
                  messageID: latest.checkpointID ?? payload.triggerMessageID ?? "",
                  type: "checkpoint",
                  sequence: latest.sequence,
                  decision: latest.decision,
                  requestedCalls: latest.requestedCalls,
                  grantedCalls: latest.grantedCalls,
                  objectiveAssessment: checkpoint.objectiveAssessment ?? "",
                  progressSummary: checkpoint.progressSummary ?? "",
                  discoveries: checkpoint.discoveries ?? [],
                  completedWork: checkpoint.completedWork ?? [],
                  remainingWork: checkpoint.remainingWork ?? [],
                  failures: checkpoint.failures ?? [],
                  blockers: checkpoint.blockers ?? [],
                  routeAssessment: checkpoint.routeAssessment ?? "",
                  routeDecision: checkpoint.routeDecision ?? "keep",
                  selfCritique: checkpoint.selfCritique ?? "",
                  failedApproaches: checkpoint.failedApproaches ?? [],
                  whatToChanges: checkpoint.whatToChanges ?? [],
                  nextActions: checkpoint.nextActions ?? [],
                  runtime: payload.telemetry,
                },
              })
            }
          }
        }
      },
    })
  }
  MobileBridge.replacePendingPermissions(permissions)
  MobileBridge.replacePendingQuestions(questions)
  MobileBridge.replaceRouteState(routeProposals, activeRoutes)
  MobileBridge.replaceRecentCheckpoints(recentCheckpoints)
  MobileBridge.sendSnapshot(clientId)
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------
