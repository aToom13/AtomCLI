import { cmd } from "./cmd"
import { SessionRetrospectiveService } from "@/core/memory/services/retrospective"
import { Session } from "@/core/session"
import { Log } from "@/util/util/log"
import { Instance } from "@/services/project/instance"
import { Config } from "@/core/config/config"

const log = Log.create({ service: "cli.daemon-learn" })

export const DaemonLearnCommand = cmd({
    command: "_daemon-learn [sessions..]",
    describe: false, // Hidden command, not shown in --help
    handler: async (args) => {
        await Instance.provide({
            directory: process.cwd(),
            fn: async () => {
                let sessionIDs = args.sessions as string[] || []

                // Auto-discover the latest session opened today if none provided
                if (sessionIDs.length === 0) {
                    try {
                        const allSessions: Session.Info[] = []
                        for await (const s of await Session.list()) {
                            allSessions.push(s)
                        }
                        // Sort by updated time descending
                        const sorted = allSessions.sort((a, b) => b.time.updated - a.time.updated)
                        // Take the latest session if available
                        if (sorted.length > 0) {
                            sessionIDs = [sorted[0].id]
                        }
                    } catch (e) {
                        log.error("Failed to list sessions for daemon learning", { e })
                    }
                }

                log.info("Daemon background retrospective started", { sessionIDs })

                for (const sessionID of sessionIDs) {
                    if (typeof sessionID !== "string") continue
                    try {
                        // Fetch messages from this specific session
                        const messages = await Session.messages({ sessionID })
                        // Send to LLM analysis and save to VDB
                        await SessionRetrospectiveService.execute(sessionID, messages)
                    } catch (error) {
                        log.error("Daemon learn failed for session", { sessionID, error })
                    }
                }

                log.info("Daemon background retrospective finished, exiting.")
                process.exit(0)
            }
        })
    },
})
