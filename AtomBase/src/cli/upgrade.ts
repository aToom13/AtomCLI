import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Flag } from "@/flag/flag"
import { Installation } from "@/installation"

export async function upgrade() {
  const config = await Config.global()
  const method = await Installation.method()
  const latest = await Installation.latest(method).catch(() => { })
  if (!latest) return
  if (Installation.VERSION === latest) return

  // Always notify user when update is available
  await Bus.publish(Installation.Event.UpdateAvailable, { version: latest })

  // If autoupdate is disabled or set to notify-only, stop here
  if (config.autoupdate === false || config.autoupdate === "notify" || Flag.ATOMCLI_DISABLE_AUTOUPDATE) {
    return
  }

  // Auto-upgrade if method is known and autoupdate is enabled
  if (method === "unknown") return
  await Installation.upgrade(method, latest)
    .then(() => Bus.publish(Installation.Event.Updated, { version: latest }))
    .catch(() => { })
}

