/**
 * NtfyService — optional HTTP push notifications via ntfy.sh
 *
 * Enable by setting `companion.ntfy_url` in your atomcli config:
 *
 *   "companion": {
 *     "ntfy_url": "https://ntfy.sh/your-topic"
 *   }
 *
 * The URL can also be a self-hosted ntfy instance.
 * Set to an empty string or omit to disable.
 */

let _url: string | null = null

export namespace NtfyService {
    /**
     * Configure the ntfy endpoint. Pass an empty string / nullish to disable.
     */
    export function configure(url: string | null | undefined): void {
        _url = url || null
        if (_url) {
            console.log(`[ntfy] notifications enabled → ${_url}`)
        }
    }

    /**
     * Send a permission-request notification to the configured ntfy topic.
     * No-ops silently if ntfy is not configured.
     */
    export async function notifyPermission(opts: {
        permission: string
        patterns: string[]
        sessionID?: string
        reqId: string
    }): Promise<void> {
        if (!_url) return
        const body =
            opts.patterns.length > 0
                ? `${opts.permission}: ${opts.patterns.slice(0, 5).join(", ")}${opts.patterns.length > 5 ? "…" : ""}`
                : opts.permission

        try {
            await fetch(_url, {
                method: "POST",
                headers: {
                    "Title": "⚠️ Permission Request",
                    "Tags": "warning,atomcli",
                    "Priority": "high",
                    "Content-Type": "text/plain",
                },
                body,
            })
        } catch (err) {
            // Never throw — ntfy is best-effort
            console.warn("[ntfy] failed to send notification:", err)
        }
    }
}
