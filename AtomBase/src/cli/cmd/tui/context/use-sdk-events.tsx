import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useToast } from "../ui/toast"
import { useChain } from "../context/chain"
import { useFileTree } from "../context/file-tree"
import { useSubAgents } from "../context/subagent"
import { useSync } from "../context/sync"
import { useCommandDialog } from "@tui/component/dialog-command"
import { TuiEvent } from "../event"
import { Session as SessionApi } from "@/session"
import { Installation } from "@/installation"

/**
 * Registers all SDK event handlers for the TUI.
 * Handles Chain events, FileTree events, Toast, Session, Error, and Installation events.
 * Extracted from App() in app.tsx to reduce component size.
 */
export function useSDKEventHandlers() {
    const sdk = useSDK()
    const route = useRoute()
    const toast = useToast()
    const command = useCommandDialog()
    const chainCtx = useChain()
    const fileTreeCtx = useFileTree()
    const subAgentCtx = useSubAgents()
    const sync = useSync()

    // Command execution
    sdk.event.on(TuiEvent.CommandExecute.type, (evt) => {
        command.trigger(evt.properties.command)
    })

    // Toast events
    sdk.event.on(TuiEvent.ToastShow.type, (evt) => {
        toast.show({
            title: evt.properties.title,
            message: evt.properties.message,
            variant: evt.properties.variant,
            duration: evt.properties.duration,
        })
    })

    // Session events
    sdk.event.on(TuiEvent.SessionSelect.type, (evt) => {
        route.navigate({
            type: "session",
            sessionID: evt.properties.sessionID,
        })
    })

    sdk.event.on(SessionApi.Event.Deleted.type, (evt) => {
        if (route.data.type === "session" && route.data.sessionID === evt.properties.info.id) {
            route.navigate({ type: "home" })
            toast.show({
                variant: "info",
                message: "The current session was deleted",
            })
        }
    })

    sdk.event.on(SessionApi.Event.Error.type, (evt) => {
        const error = evt.properties.error
        if (error && typeof error === "object" && error.name === "MessageAbortedError") return
        const message = (() => {
            if (!error) return "An error occurred"

            if (typeof error === "object") {
                const data = error.data
                if ("message" in data && typeof data.message === "string") {
                    return data.message
                }
            }
            return String(error)
        })()

        toast.show({
            variant: "error",
            message,
            duration: 5000,
        })
    })

    // Installation events
    sdk.event.on(Installation.Event.Updated.type, (evt) => {
        toast.show({
            variant: "success",
            title: "Update Complete",
            message: `AtomCLI updated to v${evt.properties.version}`,
            duration: 5000,
        })
    })

    sdk.event.on(Installation.Event.UpdateAvailable.type, (evt) => {
        toast.show({
            variant: "info",
            title: "Update Available",
            message: `AtomCLI v${evt.properties.version} is available. Run 'atomcli upgrade' to update`,
            duration: 10000,
        })
    })

    // Chain event handlers — session-scoped
    // Using `as any` because Zod inference may not expose sessionID properly
    sdk.event.on(TuiEvent.ChainStart.type, (evt) => {
        const p = evt.properties as any
        chainCtx.startChain(p.mode, p.sessionID)
    })

    sdk.event.on(TuiEvent.ChainAddStep.type, (evt) => {
        const p = evt.properties as any
        chainCtx.addStep(p.name, p.description, p.todos, {
            sessionId: p.sessionId,
            agentType: p.agentType,
            dependsOn: p.dependsOn,
            sessionID: p.sessionID,
        })
    })

    sdk.event.on(TuiEvent.ChainUpdateStep.type, (evt) => {
        const p = evt.properties as any
        chainCtx.updateStepStatus(p.status, p.tool, p.sessionID)
    })

    sdk.event.on(TuiEvent.ChainCompleteStep.type, (evt) => {
        const p = evt.properties as any
        chainCtx.completeStep(p.output, p.sessionID)
    })

    sdk.event.on(TuiEvent.ChainFailStep.type, (evt) => {
        const p = evt.properties as any
        chainCtx.failStep(p.error, p.sessionID)
    })

    sdk.event.on(TuiEvent.ChainSetTodos.type, (evt) => {
        const p = evt.properties as any
        chainCtx.setCurrentStepTodos(p.todos, p.sessionID)
    })

    sdk.event.on(TuiEvent.ChainTodoDone.type, (evt) => {
        const p = evt.properties as any
        chainCtx.markTodoDone(p.todoIndex, p.sessionID)
    })

    sdk.event.on(TuiEvent.ChainClear.type, (evt) => {
        const p = evt.properties as any
        chainCtx.clearChain(p.sessionID)
    })

    sdk.event.on(TuiEvent.ChainSubPlanStart.type, (evt) => {
        const p = evt.properties as any
        chainCtx.startSubPlan(p.stepIndex, p.reason, p.steps, p.sessionID)
    })

    sdk.event.on(TuiEvent.ChainSubPlanEnd.type, (evt) => {
        const p = evt.properties as any
        chainCtx.endSubPlan(p.stepIndex, p.success, p.sessionID)
    })

    sdk.event.on(TuiEvent.ChainParallelUpdate.type, (evt) => {
        const p = evt.properties as any
        chainCtx.updateStepByIndex(p.stepIndex, p.status, p.sessionID)
    })

    // File Tree event handlers
    sdk.event.on(TuiEvent.FileTreeToggle.type, () => {
        fileTreeCtx.toggleFileTree()
    })

    sdk.event.on(TuiEvent.FileTreeOpen.type, (evt) => {
        fileTreeCtx.openFile(evt.properties.path, evt.properties.content, evt.properties.language, evt.properties.highlight)
    })

    sdk.event.on(TuiEvent.FileTreeClose.type, (evt) => {
        fileTreeCtx.closeFile(evt.properties.path)
    })

    sdk.event.on(TuiEvent.FileTreeDirToggle.type, (evt) => {
        fileTreeCtx.toggleDir(evt.properties.path)
    })

    sdk.event.on(TuiEvent.CodePanelToggle.type, () => {
        fileTreeCtx.toggleCodePanel()
    })

    // Sub-agent panel events
    sdk.event.on(TuiEvent.SubAgentActive.type, (evt) => {
        const { sessionId, agentType, description } = evt.properties as any
        // Get current session as parent for back-navigation
        const parentId = route.data.type === "session" ? route.data.sessionID : undefined
        subAgentCtx.addAgent({ sessionId, agentType, description, parentSessionId: parentId })
        // Pre-sync the child session so messages appear in SubAgentPanel
        sync.session.sync(sessionId).catch(() => { })
    })

    sdk.event.on(TuiEvent.SubAgentDone.type, (evt) => {
        const { sessionId, lastOutput } = evt.properties as any
        subAgentCtx.markWaiting(sessionId, lastOutput)
    })

    sdk.event.on(TuiEvent.SubAgentReactivate.type, (evt) => {
        const { sessionId, description } = evt.properties as any
        subAgentCtx.reactivate(sessionId, description)
    })

    sdk.event.on(TuiEvent.SubAgentRemove.type, (evt) => {
        const { sessionId } = evt.properties as any
        subAgentCtx.removeAgent(sessionId)
    })
}

