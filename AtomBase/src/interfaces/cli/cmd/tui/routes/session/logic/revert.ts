import { createMemo, type Accessor } from "solid-js"
import { parsePatch } from "diff"
import type { Message, Session } from "@atomcli/sdk/v2"

export function useRevert(session: Accessor<Session | undefined>, messages: Accessor<Message[]>) {
    const revertInfo = createMemo(() => session()?.revert)
    const revertMessageID = createMemo(() => revertInfo()?.messageID)

    const revertDiffFiles = createMemo(() => {
        const diffText = revertInfo()?.diff ?? ""
        if (!diffText) return []

        try {
            const patches = parsePatch(diffText)
            return patches.map((patch) => {
                const filename = patch.newFileName || patch.oldFileName || "unknown"
                const cleanFilename = filename.replace(/^[ab]\//, "")
                return {
                    filename: cleanFilename,
                    additions: patch.hunks.reduce(
                        (sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("+")).length,
                        0,
                    ),
                    deletions: patch.hunks.reduce(
                        (sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("-")).length,
                        0,
                    ),
                }
            })
        } catch (error) {
            return []
        }
    })

    const revertRevertedMessages = createMemo(() => {
        const messageID = revertMessageID()
        if (!messageID) return []
        return messages().filter((x) => x.id >= messageID && x.role === "user")
    })

    const revert = createMemo(() => {
        const info = revertInfo()
        if (!info) return
        if (!info.messageID) return
        return {
            messageID: info.messageID,
            reverted: revertRevertedMessages(),
            diff: info.diff,
            diffFiles: revertDiffFiles(),
        }
    })

    return revert
}
