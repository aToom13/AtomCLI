import { Session } from "@/session"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { Log } from "@/util/log"

const log = Log.create({ service: "agent-teams.activate" })

/**
 * Bus event emitted when Agent Teams mode is activated for a session.
 * TUI and other subscribers can listen for this to trigger UI changes.
 */
export const TeamActivatedEvent = BusEvent.define(
    "agent-teams.activated",
    z.object({
        sessionID: z.string(),
        task: z.string(),
    }),
)

/**
 * Bus event emitted when Agent Teams mode is deactivated.
 */
export const TeamDeactivatedEvent = BusEvent.define(
    "agent-teams.deactivated",
    z.object({
        sessionID: z.string(),
    }),
)

/**
 * Activate Agent Teams mode for an existing session.
 *
 * This function:
 * 1. Updates the session's metadata to mark it as a "team" session.
 * 2. Publishes a Bus event so TUI and other components can react.
 *
 * Can be called from:
 * - `atomcli team "task"` CLI command
 * - A slash command (future)
 * - An agent tool call (future)
 */
export async function activateTeamMode(sessionID: string, task: string) {
    log.info("activating", { sessionID, task })

    await Session.update(sessionID, (draft) => {
        draft.metadata = {
            ...draft.metadata,
            team: {
                active: true,
                task,
                activatedAt: Date.now(),
            },
        }
    })

    Bus.publish(TeamActivatedEvent, { sessionID, task })

    log.info("activated", { sessionID })
    return { sessionID, task }
}

/**
 * Deactivate Agent Teams mode for a session.
 */
export async function deactivateTeamMode(sessionID: string) {
    log.info("deactivating", { sessionID })

    await Session.update(sessionID, (draft) => {
        if (draft.metadata?.team) {
            draft.metadata.team = {
                ...draft.metadata.team,
                active: false,
            }
        }
    })

    Bus.publish(TeamDeactivatedEvent, { sessionID })

    log.info("deactivated", { sessionID })
}
