import { onMount, onCleanup } from "solid-js"
import { usePlatform } from "@/context/platform"
import { showToast } from "@atomcli/ui/toast"

export function useAppUpdates() {
    const platform = usePlatform()

    onMount(() => {
        if (!platform.checkUpdate || !platform.update || !platform.restart) return

        let toastId: number | undefined

        async function pollUpdate() {
            const { updateAvailable, version } = await platform.checkUpdate!()
            if (updateAvailable && toastId === undefined) {
                toastId = showToast({
                    persistent: true,
                    icon: "download",
                    title: "Update available",
                    description: `A new version of AtomCLI (${version}) is now available to install.`,
                    actions: [
                        {
                            label: "Install and restart",
                            onClick: async () => {
                                await platform.update!()
                                await platform.restart!()
                            },
                        },
                        {
                            label: "Not yet",
                            onClick: "dismiss",
                        },
                    ],
                })
            }
        }

        pollUpdate()
        const interval = setInterval(pollUpdate, 10 * 60 * 1000)
        onCleanup(() => clearInterval(interval))
    })
}
