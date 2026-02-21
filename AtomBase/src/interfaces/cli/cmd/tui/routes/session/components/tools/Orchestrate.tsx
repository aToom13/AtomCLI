import { createMemo, For, Match, Show } from "solid-js"
import { useRoute } from "@tui/context/route"
import { useKeybind } from "@tui/context/keybind"
import { useTheme } from "@tui/context/theme"
import { BlockTool, type ToolProps } from "./Shared"

// Orchestrate tool types (inline since we can't import from orchestrate.ts easily)
interface OrchestrateMetadata {
  workflowId?: string
  status?: string
  childSessionIds?: string[]
  taskStatus?: Record<
    string,
    {
      status: string
      duration?: string
      sessionId?: string
      error?: string
    }
  >
}

export function Orchestrate(props: ToolProps<any>) {
  const { theme } = useTheme()
  const keybind = useKeybind()
  const { navigate } = useRoute()

  const metadata = () => props.metadata as OrchestrateMetadata
  const taskStatus = () => metadata()?.taskStatus || {}
  const childSessionIds = () => metadata()?.childSessionIds || []

  const statusEmoji = (status: string) => {
    switch (status) {
      case "completed":
        return "✅"
      case "in_progress":
      case "running":
        return "🔄"
      case "failed":
        return "❌"
      case "pending":
        return "⏳"
      case "skipped":
        return "⏭️"
      default:
        return "❓"
    }
  }

  const hasChildSessions = () => childSessionIds().length > 0

  return (
    <Show when={Object.keys(taskStatus()).length > 0}>
      <BlockTool
        title={`# Orchestrate Workflow`}
        onClick={
          hasChildSessions()
            ? () => {
                const firstSession = childSessionIds()[0]
                if (firstSession) {
                  navigate({ type: "session", sessionID: firstSession })
                }
              }
            : undefined
        }
        part={props.part}
      >
        <box flexDirection="column" gap={1}>
          {/* Workflow Status */}
          <text style={{ fg: theme.textMuted }}>
            {metadata()?.status === "completed"
              ? "✅ Completed"
              : metadata()?.status === "failed"
                ? "❌ Failed"
                : "🔄 Running"}
            {metadata()?.workflowId && ` • ${metadata()?.workflowId}`}
          </text>

          {/* Task List */}
          <box flexDirection="column" gap={0}>
            <For each={Object.entries(taskStatus())}>
              {([taskId, status]) => (
                <box flexDirection="row" gap={2}>
                  <text>{statusEmoji(status.status)}</text>
                  <text style={{ fg: theme.text }}>{taskId}</text>
                  <Show when={status.duration}>
                    <text style={{ fg: theme.textMuted }}>({status.duration})</text>
                  </Show>
                  <Show when={status.error}>
                    <text style={{ fg: theme.error }}>❌ {status.error}</text>
                  </Show>
                </box>
              )}
            </For>
          </box>

          {/* Navigation Hint */}
          <Show when={hasChildSessions()}>
            <text style={{ fg: theme.text }}>
              {keybind.print("session_child_cycle")}
              <span style={{ fg: theme.textMuted }}> view task sessions</span>
            </text>
          </Show>
        </box>
      </BlockTool>
    </Show>
  )
}
