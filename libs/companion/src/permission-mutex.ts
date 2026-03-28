/**
 * Permission Mutex (AtomBase copy)
 *
 * Prevents race conditions when both the Terminal TUI and the Mobile App
 * attempt to resolve the same permission request simultaneously.
 */
export namespace PermissionMutex {
    interface LockEntry {
        resolvedBy: "tui" | "companion" | "timeout"
        resolvedAt: number
    }

    const _locks = new Map<string, LockEntry>()
    const MAX_ENTRIES = 1000

    export function acquire(reqId: string, resolvedBy: "tui" | "companion"): boolean {
        if (_locks.has(reqId)) return false
        if (_locks.size >= MAX_ENTRIES) {
            const oldestKey = _locks.keys().next().value
            if (oldestKey !== undefined) _locks.delete(oldestKey)
        }
        _locks.set(reqId, { resolvedBy, resolvedAt: Date.now() })
        return true
    }

    export function release(reqId: string): void {
        _locks.delete(reqId)
    }

    export function getEntry(reqId: string): LockEntry | undefined {
        return _locks.get(reqId)
    }

    export function purgeOldEntries(maxAgeMs = 30 * 60 * 1000): void {
        const cutoff = Date.now() - maxAgeMs
        for (const [reqId, entry] of Array.from(_locks)) {
            if (entry.resolvedAt < cutoff) _locks.delete(reqId)
        }
    }
}
