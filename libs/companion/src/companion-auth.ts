import { verify as cryptoVerify } from "node:crypto"
import { join } from "node:path"
import { homedir } from "node:os"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"

/**
 * Companion App Authentication (AtomBase)
 *
 * Manages paired device public keys and verifies ED25519 signatures.
 * Device records are persisted to ~/.atomcli/companion-devices.json so
 * the phone can reconnect after a server restart WITHOUT re-scanning the QR.
 *
 * Key format: RAW 32-byte ED25519 keys, Base64-encoded (matches Flutter).
 * CRITICAL: Do NOT change to DER/PEM without updating the Flutter side too.
 */
export namespace CompanionAuth {
    export interface Device {
        deviceName: string
        /** Raw 32-byte ED25519 public key, Base64-encoded */
        publicKeyBase64: string
        pairedAt: number
    }

    // ---------------------------------------------------------------------------
    // Persistence
    // ---------------------------------------------------------------------------

    const _atomcliDir = join(homedir(), ".atomcli")
    const _devicesPath = join(_atomcliDir, "companion-devices.json")

    let _loaded = false
    const _devices = new Map<string, Device>()

    function _ensureDir() {
        try { mkdirSync(_atomcliDir, { recursive: true }) } catch { /* already exists */ }
    }

    /** Load persisted devices from disk (called once at startup). */
    export function loadDevices(): void {
        if (_loaded) return
        _loaded = true
        _ensureDir()
        try {
            const raw = readFileSync(_devicesPath, "utf8")
            const list: Device[] = JSON.parse(raw)
            for (const d of list) {
                _devices.set(d.deviceName, d)
            }
        } catch {
            // File doesn't exist yet — that's fine, fresh start
        }
    }

    function _saveDevices(): void {
        _ensureDir()
        try {
            const list = Array.from(_devices.values())
            writeFileSync(_devicesPath, JSON.stringify(list, null, 2), "utf8")
        } catch (err) {
            console.error("[companion-auth] failed to persist devices:", err)
        }
    }

    // ---------------------------------------------------------------------------
    // Device management
    // ---------------------------------------------------------------------------

    export function registerDevice(deviceName: string, publicKeyBase64: string): Device {
        if (!_loaded) loadDevices()
        const device: Device = { deviceName, publicKeyBase64, pairedAt: Date.now() }
        _devices.set(deviceName, device)
        _saveDevices()
        return device
    }

    export function getDevice(deviceName: string): Device | undefined {
        if (!_loaded) loadDevices()
        return _devices.get(deviceName)
    }

    export function listDevices(): Device[] {
        if (!_loaded) loadDevices()
        return Array.from(_devices.values())
    }

    export function removeDevice(deviceName: string): boolean {
        if (!_loaded) loadDevices()
        const removed = _devices.delete(deviceName)
        if (removed) _saveDevices()
        return removed
    }

    // ---------------------------------------------------------------------------
    // Signature verification
    // ---------------------------------------------------------------------------

    /**
     * Verify an ED25519 signature over `payload`.
     *
     * ED25519 uses the single-pass `crypto.verify(null, data, key, sig)` API.
     * The stream-based `createVerify('ed25519')` throws ERR_CRYPTO_INVALID_DIGEST.
     *
     * Import aliased as `cryptoVerify` to avoid name shadowing by this function.
     */
    export function verify(deviceName: string, payload: string, signatureB64: string): boolean {
        const device = _devices.get(deviceName) ?? (loadDevices(), _devices.get(deviceName))
        if (!device) return false
        try {
            const rawPub = Buffer.from(device.publicKeyBase64, "base64")
            if (rawPub.length !== 32) return false
            // Wrap raw 32-byte key in ASN.1 SPKI DER envelope for Node.js crypto
            const derPrefix = Buffer.from("302a300506032b6570032100", "hex")
            const derKey = Buffer.concat([derPrefix, rawPub])
            const signature = Buffer.from(signatureB64, "base64")
            if (signature.length !== 64) return false
            const payloadBuffer = Buffer.from(payload, "utf-8")
            return (cryptoVerify as Function)(null, payloadBuffer, { key: derKey, format: "der", type: "spki" }, signature)
        } catch {
            return false
        }
    }

    // ---------------------------------------------------------------------------
    // Pairing token management (in-memory only — short-lived by design)
    // ---------------------------------------------------------------------------

    const _tokens = new Map<string, { expiresAt: number }>()

    export function issueToken(ttlMs = 5 * 60 * 1000): string {
        const token = globalThis.crypto.randomUUID()
        _tokens.set(token, { expiresAt: Date.now() + ttlMs })
        return token
    }

    export function consumeToken(token: string): boolean {
        const entry = _tokens.get(token)
        if (!entry) return false
        _tokens.delete(token)
        return Date.now() <= entry.expiresAt
    }

    export function purgeExpiredTokens(): void {
        const now = Date.now()
        for (const [token, { expiresAt }] of Array.from(_tokens)) {
            if (now > expiresAt) _tokens.delete(token)
        }
    }
}
