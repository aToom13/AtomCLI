import { Instance } from "../../project/instance"
import { MessageV2 } from "../message-v2"
import { Session } from ".."
import { NamedError } from "@atomcli/util/error"
import { Log } from "../../util/log"

const log = Log.create({ service: "session", file: "prompt/state" })

export const state = Instance.state(
    () => {
        const data: Record<
            string,
            {
                abort: AbortController
                callbacks: {
                    resolve: (msg: MessageV2.Model) => void
                    reject: () => void
                }[]
            }
        > = {}
        return data
    },
    async (current) => {
        for (const item of Object.values(current)) {
            item.abort.abort()
            for (const callback of item.callbacks) {
                callback.reject()
            }
        }
    },
)

export function resolve(input: MessageV2.WithParts) {
    // we only care about model messages for now to resolve the prompt promise
    if (input.info.role !== "assistant") return

    // resolve pending prompts
    const pending = state()[input.info.sessionID]
    if (pending) {
        for (const callback of pending.callbacks) {
            callback.resolve(input as MessageV2.Model)
        }
        pending.callbacks = []
    }
}

export function reject() {
    for (const item of Object.values(state())) {
        for (const callback of item.callbacks) {
            callback.reject()
        }
        item.callbacks = []
    }
}

export function assertNotBusy(sessionID: string) {
    if (state()[sessionID]) {
        throw new Session.BusyError(sessionID)
    }
}

export function start(sessionID: string) {
    const current = state()
    if (current[sessionID]) {
        return null
    }
    const abort = new AbortController()
    current[sessionID] = {
        abort,
        callbacks: [],
    }
    return abort.signal
}

export function cancel(sessionID: string) {
    const current = state()
    const item = current[sessionID]
    if (item) {
        item.abort.abort()
        const error = new NamedError.Aborted("Session cancelled")
        for (const callback of item.callbacks) {
            callback.reject()
        }
        delete current[sessionID]
        log.info("cancelled", { sessionID })
    }
}
