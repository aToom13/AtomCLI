import path from "path"
import os from "os"
import fs from "fs/promises"
import { Session } from ".."
import { SessionRevert } from "../revert"
import { Agent } from "../../agent/agent"
import { Instance } from "../../project/instance"
import { ConfigMarkdown } from "../../config/markdown"
import { fn } from "../../util/fn"
import { PermissionNext } from "../../permission/next"
import { Skill } from "../../skill"
import { PromptInput } from "./types"
import { createUserMessage } from "./messages"
import { loop } from "./loop"

export const prompt = fn(PromptInput, async (input) => {
    const session = await Session.get(input.sessionID)
    await SessionRevert.cleanup(session)

    const message = await createUserMessage(input)
    await Session.touch(input.sessionID)

    // this is backwards compatibility for allowing `tools` to be specified when prompting
    const permissions: PermissionNext.Ruleset = []
    for (const [tool, enabled] of Object.entries(input.tools ?? {})) {
        permissions.push({
            permission: tool,
            action: enabled ? "allow" : "deny",
            pattern: "*",
        })
    }
    if (permissions.length > 0) {
        session.permission = permissions
        await Session.update(session.id, (draft) => {
            draft.permission = permissions
        })
    }

    if (input.noReply === true) {
        return message
    }

    return loop(input.sessionID)
})

export async function resolvePromptParts(template: string): Promise<PromptInput["parts"]> {
    const parts: PromptInput["parts"] = [
        {
            type: "text",
            text: template,
        },
    ]
    const files = ConfigMarkdown.files(template)
    const seen = new Set<string>()
    await Promise.all(
        files.map(async (match) => {
            const name = match[1]
            if (seen.has(name)) return
            seen.add(name)
            const filepath = name.startsWith("~/")
                ? path.join(os.homedir(), name.slice(2))
                : path.resolve(Instance.worktree, name)

            const stats = await fs.stat(filepath).catch(() => undefined)
            if (!stats) {
                // First, check if it's a skill
                const skill = await Skill.get(name)
                if (skill) {
                    const parsed = await ConfigMarkdown.parse(skill.location)
                    parts.push({
                        type: "text",
                        text: `\n<skill name="${skill.name}">\n${parsed.content.trim()}\n</skill>\n`,
                    })
                    return
                }

                // If not a skill, check for agent
                const agent = await Agent.get(name)
                if (agent) {
                    parts.push({
                        type: "agent",
                        name: agent.name,
                    })
                }
                return
            }

            if (stats.isDirectory()) {
                parts.push({
                    type: "file",
                    url: `file://${filepath}`,
                    filename: name,
                    mime: "application/x-directory",
                })
                return
            }

            parts.push({
                type: "file",
                url: `file://${filepath}`,
                filename: name,
                mime: "text/plain",
            })
        }),
    )
    return parts
}
