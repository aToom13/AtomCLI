import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Flag } from "@/flag/flag"
import { Installation } from "@/installation"

/**
 * Compare two semantic versions. Returns true if `remote` is newer than `local`.
 * Handles versions like "2.0.9", "2.1.0-main.abc123", "v2.0.9", "local"
 */
function isNewerVersion(local: string, remote: string): boolean {
  // Handle special cases
  if (local === "local" || remote === "local") return false
  if (local === remote) return false

  // Strip 'v' prefix if present
  const cleanLocal = local.replace(/^v/, "").split("-")[0] // "2.1.0-main.abc" -> "2.1.0"
  const cleanRemote = remote.replace(/^v/, "").split("-")[0]

  const localParts = cleanLocal.split(".").map(n => parseInt(n, 10) || 0)
  const remoteParts = cleanRemote.split(".").map(n => parseInt(n, 10) || 0)

  // Pad arrays to same length
  while (localParts.length < 3) localParts.push(0)
  while (remoteParts.length < 3) remoteParts.push(0)

  // Compare major.minor.patch
  for (let i = 0; i < 3; i++) {
    if (remoteParts[i] > localParts[i]) return true
    if (remoteParts[i] < localParts[i]) return false
  }

  return false
}

export async function upgrade() {
  const config = await Config.global()
  const method = await Installation.method()
  const latest = await Installation.latest(method).catch(() => { })
  if (!latest) return

  // Only show notification if remote version is actually newer
  if (!isNewerVersion(Installation.VERSION, latest)) return

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
