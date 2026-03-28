import { describe, expect, test, beforeEach } from "bun:test"
import { PermissionMutex } from "@atomcli/companion"

describe("PermissionMutex", () => {
    beforeEach(() => {
        // Clear any existing entries by purging everything older than 0ms ago
        PermissionMutex.purgeOldEntries(-1)
    })

    test("should acquire lock when free", () => {
        const success = PermissionMutex.acquire("req_1", "tui")
        expect(success).toBe(true)
        const entry = PermissionMutex.getEntry("req_1")
        expect(entry).toBeDefined()
        expect(entry?.resolvedBy).toBe("tui")
    })

    test("should fail to acquire lock when already held", () => {
        PermissionMutex.acquire("req_2", "companion")
        const success = PermissionMutex.acquire("req_2", "tui")
        expect(success).toBe(false)
    })

    test("should allow acquiring after release", () => {
        PermissionMutex.acquire("req_3", "tui")
        PermissionMutex.release("req_3")
        const success = PermissionMutex.acquire("req_3", "companion")
        expect(success).toBe(true)
    })

    test("should purge old entries", () => {
        PermissionMutex.acquire("req_4", "tui")

        // Fast-forward time is tricky, but we can purge with maxAgeMs = -1 
        // to purge everything created before "now - (-1)" which is in the future.
        PermissionMutex.purgeOldEntries(-1)

        expect(PermissionMutex.getEntry("req_4")).toBeUndefined()
    })

    test("should enforce MAX_ENTRIES by evicting oldest", () => {
        // Fill up to max entries (1000)
        for (let i = 0; i < 1000; i++) {
            PermissionMutex.acquire(`req_max_${i}`, "tui")
        }

        // Add one more
        PermissionMutex.acquire("req_overflow", "tui")

        // The oldest one (req_max_0) should be evicted
        expect(PermissionMutex.getEntry("req_max_0")).toBeUndefined()
        expect(PermissionMutex.getEntry("req_overflow")).toBeDefined()
    })
})
