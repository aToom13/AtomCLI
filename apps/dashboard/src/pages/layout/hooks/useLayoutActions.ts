import { useNavigate, useParams } from "@solidjs/router"
import { useDialog } from "@atomcli/ui/context/dialog"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useLayout } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { base64Encode, base64Decode } from "@atomcli/util/encode"
import { Binary } from "@atomcli/util/binary"
import { produce } from "solid-js/store"
import { DialogSelectProvider } from "@/components/dialog-select-provider"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { Session } from "@atomcli/sdk/v2/client"

export function useLayoutActions(lastSession: () => Record<string, string>) {
    const dialog = useDialog()
    const platform = usePlatform()
    const server = useServer()
    const layout = useLayout()
    const navigate = useNavigate()
    const globalSync = useGlobalSync()
    const globalSDK = useGlobalSDK()
    const params = useParams()

    function connectProvider() {
        dialog.show(() => <DialogSelectProvider />)
    }

    function openServer() {
        dialog.show(() => <DialogSelectServer />)
    }

    function navigateToProject(directory: string | undefined) {
        if (!directory) return
        const last = lastSession()[directory]
        navigate(`/${base64Encode(directory)}${last ? `/session/${last}` : ""}`)
        layout.mobileSidebar.hide()
    }

    function navigateToSession(session: Session | undefined) {
        if (!session) return
        navigate(`/${base64Encode(session.directory)}/session/${session.id}`)
        layout.mobileSidebar.hide()
    }

    function openProject(directory: string, navigate = true) {
        layout.projects.open(directory)
        if (navigate) navigateToProject(directory)
    }

    function closeProject(directory: string) {
        const list = layout.projects.list()
        const index = list.findIndex((x) => x.worktree === directory)
        const next = list[index + 1]
        layout.projects.close(directory)
        if (next) navigateToProject(next.worktree)
        else navigate("/")
    }

    async function chooseProject() {
        function resolve(result: string | string[] | null) {
            if (Array.isArray(result)) {
                for (const directory of result) {
                    openProject(directory, false)
                }
                navigateToProject(result[0])
            } else if (result) {
                openProject(result)
            }
        }

        if (platform.openDirectoryPickerDialog && server.isLocal()) {
            const result = await platform.openDirectoryPickerDialog?.({
                title: "Open project",
                multiple: true,
            })
            resolve(result)
        } else {
            dialog.show(
                () => <DialogSelectDirectory multiple={ true} onSelect = { resolve } />,
                () => resolve(null),
            )
        }
    }

    async function archiveSession(session: Session) {
        const [store, setStore] = globalSync.child(session.directory)
        const sessions = store.session ?? []
        const index = sessions.findIndex((s) => s.id === session.id)
        const nextSession = sessions[index + 1] ?? sessions[index - 1]

        await globalSDK.client.session.update({
            directory: session.directory,
            sessionID: session.id,
            time: { archived: Date.now() },
        })
        setStore(
            produce((draft) => {
                const match = Binary.search(draft.session, session.id, (s) => s.id)
                if (match.found) draft.session.splice(match.index, 1)
            }),
        )
        if (session.id === params.id) {
            if (nextSession) {
                navigate(`/${params.dir}/session/${nextSession.id}`)
            } else {
                navigate(`/${params.dir}/session`)
            }
        }
    }

    return {
        connectProvider,
        openServer,
        navigateToProject,
        navigateToSession,
        openProject,
        closeProject,
        chooseProject,
        archiveSession
    }
}
