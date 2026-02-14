import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useToast } from "../ui/toast"
import { useChain } from "../context/chain"
import { useFileTree } from "../context/file-tree"
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

    // Chain event handlers
    sdk.event.on(TuiEvent.ChainStart.type, (evt) => {
        chainCtx.startChain(evt.properties.mode)
    })

    sdk.event.on(TuiEvent.ChainAddStep.type, (evt) => {
        chainCtx.addStep(evt.properties.name, evt.properties.description, evt.properties.todos)
    })

    sdk.event.on(TuiEvent.ChainUpdateStep.type, (evt) => {
        chainCtx.updateStepStatus(evt.properties.status, evt.properties.tool)
    })

    sdk.event.on(TuiEvent.ChainCompleteStep.type, (evt) => {
        chainCtx.completeStep(evt.properties.output)
    })

    sdk.event.on(TuiEvent.ChainFailStep.type, (evt) => {
        chainCtx.failStep(evt.properties.error)
    })

    sdk.event.on(TuiEvent.ChainSetTodos.type, (evt) => {
        chainCtx.setCurrentStepTodos(evt.properties.todos)
    })

    sdk.event.on(TuiEvent.ChainTodoDone.type, (evt) => {
        chainCtx.markTodoDone(evt.properties.todoIndex)
    })

    sdk.event.on(TuiEvent.ChainClear.type, () => {
        chainCtx.clearChain()
    })

    sdk.event.on(TuiEvent.ChainSubPlanStart.type, (evt) => {
        chainCtx.startSubPlan(evt.properties.stepIndex, evt.properties.reason, evt.properties.steps)
    })

    sdk.event.on(TuiEvent.ChainSubPlanEnd.type, (evt) => {
        chainCtx.endSubPlan(evt.properties.stepIndex, evt.properties.success)
    })

    sdk.event.on(TuiEvent.ChainParallelUpdate.type, (evt) => {
        chainCtx.updateStepByIndex(evt.properties.stepIndex, evt.properties.status)
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
}
