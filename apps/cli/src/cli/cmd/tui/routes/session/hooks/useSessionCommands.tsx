import { useCommandDialog } from "@tui/component/dialog-command"
import type { SessionCommandContext } from "./session-commands/types"
import { useSessionManagementCommands } from "./session-commands/useSessionManagementCommands"
import { useMessageOperationsCommands } from "./session-commands/useMessageOperationsCommands"
import { useViewSettingsCommands } from "./session-commands/useViewSettingsCommands"
import { useTimelineCommands } from "./session-commands/useTimelineCommands"

export type { SessionCommandContext } from "./session-commands/types"

export function useSessionCommands(ctx: SessionCommandContext) {
    const command = useCommandDialog()

    const management = useSessionManagementCommands(ctx)
    const operations = useMessageOperationsCommands(ctx)
    const view = useViewSettingsCommands(ctx)
    const timeline = useTimelineCommands(ctx)

    command.register(() => [
        ...management,
        ...timeline,
        ...operations,
        ...view,
    ])
}
