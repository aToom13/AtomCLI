import { Show } from "solid-js"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useToast } from "@tui/ui/toast"

export function DialogExecutionRecovery(props: { sessionID: string }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const executions = () => sync.data.execution_snapshot[props.sessionID]?.executions ?? []
  const unknown = () =>
    executions().flatMap((execution) => (execution.unknownWork ?? []).map((work) => ({ execution, work })))

  return (
    <Show
      when={unknown().length > 0}
      fallback={<text fg="yellow">No unknown mutating work requires reconciliation.</text>}
    >
      <DialogSelect
        title="Reconcile uncertain work"
        description={<text>Choose operation only after checking whether browser/file action actually happened.</text>}
        options={unknown().map(({ execution, work }) => ({
          title: `${work.kind} · ${work.id}`,
          value: { execution, work },
          description: `execution ${execution.id} · version ${execution.version} · work version ${work.version}`,
        }))}
        onSelect={(option) => {
          dialog.replace(() => (
            <DialogSelect
              title="Resolution state"
              options={[
                { title: "Completed", value: "completed", description: "Operation definitely happened" },
                { title: "Failed", value: "failed", description: "Operation definitely did not happen" },
                { title: "Cancelled", value: "cancelled", description: "Operation was intentionally cancelled" },
              ]}
              onSelect={async (state) => {
                const evidence = await DialogPrompt.show(dialog, "Evidence for reconciliation", {
                  placeholder: "What did you verify?",
                })
                if (!evidence?.trim()) return
                try {
                  await sdk.client.session.executions.reconcile(
                    {
                      sessionID: props.sessionID,
                      executionID: option.value.execution.id,
                      requestID: crypto.randomUUID(),
                      operationID: option.value.work.id,
                      state: state.value as "completed" | "failed" | "cancelled",
                      expectedVersion: option.value.execution.version,
                      expectedWorkVersion: option.value.work.version,
                      evidence: evidence.trim(),
                      resolutionCode: "user_verified",
                    },
                    { throwOnError: true },
                  )
                  await sync.session.refreshExecutions(props.sessionID)
                  toast.show({ title: "Execution recovery", message: "Work reconciled", variant: "success" })
                  dialog.clear()
                } catch (error) {
                  toast.show({
                    title: "Execution recovery",
                    message: error instanceof Error ? error.message : String(error),
                    variant: "error",
                  })
                }
              }}
            />
          ))
        }}
      />
    </Show>
  )
}
