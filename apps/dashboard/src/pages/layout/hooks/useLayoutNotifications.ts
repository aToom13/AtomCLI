import { onCleanup, onMount, createEffect } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { usePermission } from "@/context/permission"
import { usePlatform } from "@/context/platform"
import { showToast, toaster } from "@atomcli/ui/toast"
import { getFilename } from "@atomcli/util/path"
import { base64Decode, base64Encode } from "@atomcli/util/encode"

export function useLayoutNotifications() {
    const globalSDK = useGlobalSDK()
    const globalSync = useGlobalSync()
    const permission = usePermission()
    const platform = usePlatform()
    const navigate = useNavigate()
    const params = useParams()

    onMount(() => {
        const toastBySession = new Map<string, number>()
        const alertedAtBySession = new Map<string, number>()
        const permissionAlertCooldownMs = 5000

        const unsub = globalSDK.event.listen((e) => {
            if (e.details?.type !== "permission.asked") return
            const directory = e.name
            const perm = e.details.properties
            if (permission.autoResponds(perm, directory)) return

            const [store] = globalSync.child(directory)
            const session = store.session.find((s) => s.id === perm.sessionID)
            const sessionKey = `${directory}:${perm.sessionID}`

            const sessionTitle = session?.title ?? "New session"
            const projectName = getFilename(directory)
            const description = `${sessionTitle} in ${projectName} needs permission`
            const href = `/${base64Encode(directory)}/session/${perm.sessionID}`

            const now = Date.now()
            const lastAlerted = alertedAtBySession.get(sessionKey) ?? 0
            if (now - lastAlerted < permissionAlertCooldownMs) return
            alertedAtBySession.set(sessionKey, now)

            void platform.notify("Permission required", description, href)

            const currentDir = params.dir ? base64Decode(params.dir) : undefined
            const currentSession = params.id
            if (directory === currentDir && perm.sessionID === currentSession) return
            if (directory === currentDir && session?.parentID === currentSession) return

            const existingToastId = toastBySession.get(sessionKey)
            if (existingToastId !== undefined) {
                toaster.dismiss(existingToastId)
            }

            const toastId = showToast({
                persistent: true,
                icon: "checklist",
                title: "Permission required",
                description,
                actions: [
                    {
                        label: "Go to session",
                        onClick: () => {
                            navigate(href)
                        },
                    },
                    {
                        label: "Dismiss",
                        onClick: "dismiss",
                    },
                ],
            })
            toastBySession.set(sessionKey, toastId)
        })
        onCleanup(unsub)

        createEffect(() => {
            const currentDir = params.dir ? base64Decode(params.dir) : undefined
            const currentSession = params.id
            if (!currentDir || !currentSession) return
            const sessionKey = `${currentDir}:${currentSession}`
            const toastId = toastBySession.get(sessionKey)
            if (toastId !== undefined) {
                toaster.dismiss(toastId)
                toastBySession.delete(sessionKey)
                alertedAtBySession.delete(sessionKey)
            }
            const [store] = globalSync.child(currentDir)
            const childSessions = store.session.filter((s) => s.parentID === currentSession)
            for (const child of childSessions) {
                const childKey = `${currentDir}:${child.id}`
                const childToastId = toastBySession.get(childKey)
                if (childToastId !== undefined) {
                    toaster.dismiss(childToastId)
                    toastBySession.delete(childKey)
                    alertedAtBySession.delete(childKey)
                }
            }
        })
    })
}
