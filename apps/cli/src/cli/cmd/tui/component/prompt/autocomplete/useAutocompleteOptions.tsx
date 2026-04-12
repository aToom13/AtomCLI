import { createMemo, createResource, createEffect, onMount, onCleanup, Index, Show, createSignal, type Accessor } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { useCommandDialog } from "@tui/component/dialog-command"
import { Locale } from "@/util/locale"
import { Skill } from "@/skill"
import { useFrecency } from "../frecency"
import type { AutocompleteOption, AutocompleteRef } from "./types"
import { extractLineRange, removeLineRange } from "./utils"
import type { PromptInfo } from "../history"
import { BoxRenderable, TextareaRenderable } from "@opentui/core"
import { firstBy } from "remeda"
import fuzzysort from "fuzzysort"

export function useAutocompleteOptions(props: {
    visible: AutocompleteRef["visible"]
    filter: Accessor<string | undefined>
    anchor: () => BoxRenderable
    input: () => TextareaRenderable
    triggerIndex: () => number
    sessionID?: string
    setPrompt: (input: (prompt: PromptInfo) => void) => void
    setExtmark: (partIndex: number, extmarkId: number) => void
    fileStyleId: number
    agentStyleId: number
    promptPartTypeId: () => number
    insertPart: (text: string, part: PromptInfo["parts"][number]) => void
}) {
    const sdk = useSDK()
    const sync = useSync()
    const command = useCommandDialog()
    const frecency = useFrecency()

    const [files] = createResource(
        () => props.filter(),
        async (query) => {
            if (!props.visible || props.visible === "/") return []

            const { lineRange, baseQuery } = extractLineRange(query ?? "")

            const result = await sdk.client.find.files({
                query: baseQuery,
            })

            const options: AutocompleteOption[] = []

            if (!result.error && result.data) {
                const sortedFiles = result.data.sort((a, b) => {
                    const aScore = frecency.getFrecency(a)
                    const bScore = frecency.getFrecency(b)
                    if (aScore !== bScore) return bScore - aScore
                    const aDepth = a.split("/").length
                    const bDepth = b.split("/").length
                    if (aDepth !== bDepth) return aDepth - bDepth
                    return a.localeCompare(b)
                })

                const width = props.anchor().width - 4
                options.push(
                    ...sortedFiles.map((item): AutocompleteOption => {
                        let url = `file://${process.cwd()}/${item}`
                        let filename = item
                        if (lineRange && !item.endsWith("/")) {
                            filename = `${item}#${lineRange.startLine}${lineRange.endLine ? `-${lineRange.endLine}` : ""}`
                            const urlObj = new URL(url)
                            urlObj.searchParams.set("start", String(lineRange.startLine))
                            if (lineRange.endLine !== undefined) {
                                urlObj.searchParams.set("end", String(lineRange.endLine))
                            }
                            url = urlObj.toString()
                        }

                        const isDir = item.endsWith("/")
                        return {
                            display: Locale.truncateMiddle(filename, width),
                            value: filename,
                            isDirectory: isDir,
                            path: item,
                            onSelect: () => {
                                props.insertPart(filename, {
                                    type: "file",
                                    mime: "text/plain",
                                    filename,
                                    url,
                                    source: {
                                        type: "file",
                                        text: {
                                            start: 0,
                                            end: 0,
                                            value: "",
                                        },
                                        path: item,
                                    },
                                })
                            },
                        }
                    }),
                )
            }

            return options
        },
        {
            initialValue: [],
        },
    )

    const mcpResources = createMemo(() => {
        if (!props.visible || props.visible === "/") return []

        const options: AutocompleteOption[] = []
        const width = props.anchor().width - 4

        for (const res of Object.values(sync.data.mcp_resource)) {
            const text = `${res.name} (${res.uri})`
            options.push({
                display: Locale.truncateMiddle(text, width),
                value: text,
                description: res.description,
                onSelect: () => {
                    props.insertPart(res.name, {
                        type: "file",
                        mime: res.mimeType ?? "text/plain",
                        filename: res.name,
                        url: res.uri,
                        source: {
                            type: "resource",
                            text: {
                                start: 0,
                                end: 0,
                                value: "",
                            },
                            clientName: res.client,
                            uri: res.uri,
                        },
                    })
                },
            })
        }

        return options
    })

    const agents = createMemo(() => {
        const agents = sync.data.agent
        return agents
            .filter((agent) => !agent.hidden && agent.mode !== "primary")
            .map(
                (agent): AutocompleteOption => ({
                    display: "@" + agent.name,
                    onSelect: () => {
                        props.insertPart(agent.name, {
                            type: "agent",
                            name: agent.name,
                            source: {
                                start: 0,
                                end: 0,
                                value: "",
                            },
                        })
                    },
                }),
            )
    })

    const [skillsList] = createResource(
        () => props.visible === "@",
        async (shouldFetch) => {
            if (!shouldFetch) return []
            return await Skill.all()
        },
        { initialValue: [] }
    )

    const skills = createMemo((): AutocompleteOption[] => {
        const list = skillsList() || []
        return list.map(
            (skill): AutocompleteOption => ({
                display: "@" + skill.name,
                description: skill.description,
                onSelect: () => {
                    const input = props.input()
                    const currentCursorOffset = input.cursorOffset

                    const charAfterCursor = input.plainText.at(currentCursorOffset)
                    const needsSpace = charAfterCursor !== " "
                    const append = "@" + skill.name + (needsSpace ? " " : "")

                    input.cursorOffset = props.triggerIndex()
                    const startCursor = input.logicalCursor
                    input.cursorOffset = currentCursorOffset
                    const endCursor = input.logicalCursor

                    input.deleteRange(startCursor.row, startCursor.col, endCursor.row, endCursor.col)
                    input.insertText(append)
                },
            })
        )
    })

    const session = createMemo(() => (props.sessionID ? sync.session.get(props.sessionID) : undefined))
    const commands = createMemo((): AutocompleteOption[] => {
        const results: AutocompleteOption[] = []
        const s = session()
        for (const command of sync.data.command) {
            results.push({
                display: "/" + command.name + (command.mcp ? " (MCP)" : ""),
                description: command.description,
                onSelect: () => {
                    const newText = "/" + command.name + " "
                    const cursor = props.input().logicalCursor
                    props.input().deleteRange(0, 0, cursor.row, cursor.col)
                    props.input().insertText(newText)
                    props.input().cursorOffset = Bun.stringWidth(newText)
                },
            })
        }
        if (s) {
            results.push(
                { display: "/undo", description: "undo the last message", onSelect: () => command.trigger("session.undo") },
                { display: "/redo", description: "redo the last message", onSelect: () => command.trigger("session.redo") },
                { display: "/compact", aliases: ["/summarize"], description: "compact the session", onSelect: () => command.trigger("session.compact") },
                { display: "/unshare", disabled: !s.share, description: "unshare a session", onSelect: () => command.trigger("session.unshare") },
                { display: "/rename", description: "rename session", onSelect: () => command.trigger("session.rename") },
                { display: "/copy", description: "copy session transcript to clipboard", onSelect: () => command.trigger("session.copy") },
                { display: "/export", description: "export session transcript to file", onSelect: () => command.trigger("session.export") },
                { display: "/timeline", description: "jump to message", onSelect: () => command.trigger("session.timeline") },
                { display: "/fork", description: "fork from message", onSelect: () => command.trigger("session.fork") },
                { display: "/thinking", description: "toggle thinking visibility", onSelect: () => command.trigger("session.toggle.thinking") },
            )
            if (sync.data.config.share !== "disabled") {
                results.push({ display: "/share", disabled: !!s.share?.url, description: "share a session", onSelect: () => command.trigger("session.share") })
            }
        }

        results.push(
            { display: "/new", aliases: ["/clear"], description: "create a new session", onSelect: () => command.trigger("session.new") },
            { display: "/models", description: "list models", onSelect: () => command.trigger("model.list") },
            { display: "/agents", description: "list agents", onSelect: () => command.trigger("agent.list") },
            { display: "/session", aliases: ["/resume", "/continue"], description: "list sessions", onSelect: () => command.trigger("session.list") },
            { display: "/status", description: "show status", onSelect: () => command.trigger("atomcli.status") },
            { display: "/mcp", description: "toggle MCPs", onSelect: () => command.trigger("mcp.list") },
            { display: "/theme", description: "toggle theme", onSelect: () => command.trigger("theme.switch") },
            { display: "/editor", description: "open editor", onSelect: () => command.trigger("prompt.editor", "prompt") },
            { display: "/connect", description: "connect to a provider", onSelect: () => command.trigger("provider.connect") },
            { display: "/help", description: "show help", onSelect: () => command.trigger("help.show") },
            { display: "/skill", aliases: ["/skills"], description: "list available skills", onSelect: () => command.trigger("skill.list") },
            { display: "/commands", description: "show all commands", onSelect: () => command.show() },
            {
                display: "/yolo",
                aliases: ["/autonomous", "/safe"],
                description: "toggle autonomous mode (auto-approve tools)",
                onSelect: async () => {
                    const isCurrentlyAutonomous = process.env.ATOMCLI_AUTONOMOUS === "1" || (sync.data.config as any).agent_mode === "autonomous"
                    const newMode = isCurrentlyAutonomous ? "safe" : "autonomous"
                    try {
                        await sdk.client.config.update({ agent_mode: newMode } as any)
                        sync.set("config", "agent_mode" as any, newMode)
                        if (newMode === "autonomous") {
                            process.env.ATOMCLI_AUTONOMOUS = "1"
                        } else {
                            delete process.env.ATOMCLI_AUTONOMOUS
                        }
                    } catch (e) { }
                },
            },
            { display: "/exit", aliases: ["/quit", "/q"], description: "exit the app", onSelect: () => command.trigger("app.exit") },
        )
        const max = firstBy(results, [(x) => x.display.length, "desc"])?.display.length
        if (!max) return results
        return results.map((item) => ({
            ...item,
            display: item.display.padEnd(max + 2),
        }))
    })

    const options = createMemo((prev: AutocompleteOption[] | undefined) => {
        const filesValue = files()
        const agentsValue = agents()
        const commandsValue = commands()
        const skillsValue = skills()

        const mixed: AutocompleteOption[] = (
            props.visible === "@" ? [...skillsValue, ...agentsValue, ...(filesValue || []), ...mcpResources()] : [...commandsValue]
        ).filter((x) => x.disabled !== true)

        const currentFilter = props.filter()

        if (!currentFilter) {
            return mixed
        }

        if (files.loading && prev && prev.length > 0) {
            return prev
        }

        const result = fuzzysort.go(removeLineRange(currentFilter), mixed, {
            keys: [
                (obj) => removeLineRange((obj.value ?? obj.display).trimEnd()),
                "description",
                (obj) => obj.aliases?.join(" ") ?? "",
            ],
            limit: 10,
            scoreFn: (objResults) => {
                const displayResult = objResults[0]
                let score = objResults.score
                if (displayResult && displayResult.target.startsWith(props.visible + currentFilter)) {
                    score *= 2
                }
                const frecencyScore = objResults.obj.path ? frecency.getFrecency(objResults.obj.path) : 0
                return score * (1 + frecencyScore)
            },
        })

        return result.map((arr) => arr.obj)
    })

    return {
        options,
        loading: () => files.loading,
        skills, // Exporting skills explicitly to handle its specific onSelect if needed
    }
}
