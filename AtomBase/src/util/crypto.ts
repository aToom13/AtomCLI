import crypto from "crypto"
import path from "path"
import fs from "fs/promises"
import { Global } from "../global"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 16
const TAG_LENGTH = 16
const ENCRYPTED_PREFIX = "ATOMCLI_ENC:"
const KEYFILE_NAME = ".keyfile"

export namespace Crypto {
    let cachedKey: Buffer | null = null

    /**
     * Returns the path to the machine-local keyfile
     */
    function keyfilePath(): string {
        return path.join(Global.Path.data, KEYFILE_NAME)
    }

    /**
     * Get or create the machine-local encryption key.
     * The key is stored in ~/.atomcli/data/.keyfile with 0o600 permissions.
     * Once loaded, it is cached in memory for the process lifetime.
     */
    async function getKey(): Promise<Buffer> {
        if (cachedKey) return cachedKey

        const kp = keyfilePath()

        try {
            const existing = await fs.readFile(kp)
            if (existing.length === 32) {
                cachedKey = existing
                return cachedKey
            }
        } catch {
            // Key doesn't exist yet, will be created below
        }

        // Generate a new random 256-bit key
        const newKey = crypto.randomBytes(32)
        await fs.writeFile(kp, newKey, { mode: 0o600 })
        cachedKey = newKey
        return cachedKey
    }

    /**
     * Encrypt a plaintext string using AES-256-GCM.
     * Returns a string with the format: ATOMCLI_ENC:<base64(iv + tag + ciphertext)>
     */
    export async function encrypt(plaintext: string): Promise<string> {
        const key = await getKey()
        const iv = crypto.randomBytes(IV_LENGTH)
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

        const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
        const tag = cipher.getAuthTag()

        // Pack: iv (16) + tag (16) + ciphertext
        const packed = Buffer.concat([iv, tag, encrypted])
        return ENCRYPTED_PREFIX + packed.toString("base64")
    }

    /**
     * Decrypt a string that was encrypted with `encrypt()`.
     * If the input is not encrypted (no ATOMCLI_ENC: prefix), returns it as-is
     * for backward compatibility with plaintext data.
     */
    export async function decrypt(data: string): Promise<string> {
        // Backward compatibility: if data doesn't start with our prefix, it's plaintext
        if (!isEncrypted(data)) {
            return data
        }

        const key = await getKey()
        const packed = Buffer.from(data.slice(ENCRYPTED_PREFIX.length), "base64")

        const iv = packed.subarray(0, IV_LENGTH)
        const tag = packed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
        const ciphertext = packed.subarray(IV_LENGTH + TAG_LENGTH)

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
        decipher.setAuthTag(tag)

        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
        return decrypted.toString("utf8")
    }

    /**
     * Check if a string is encrypted (has the ATOMCLI_ENC: prefix).
     */
    export function isEncrypted(data: string): boolean {
        return data.startsWith(ENCRYPTED_PREFIX)
    }

    /**
     * Encrypt a JSON-serializable object. Returns the encrypted string.
     */
    export async function encryptJSON(obj: unknown): Promise<string> {
        return encrypt(JSON.stringify(obj, null, 2))
    }

    /**
     * Decrypt a string and parse it as JSON.
     * Handles backward compatibility with plaintext JSON.
     */
    export async function decryptJSON<T = unknown>(data: string): Promise<T> {
        const decrypted = await decrypt(data)
        return JSON.parse(decrypted) as T
    }

    /**
     * Verify an HMAC-SHA256 signature against a body using a shared secret.
     * Used for remote config integrity verification.
     */
    export function verifyHMAC(body: string, signature: string, secret: string): boolean {
        const expected = crypto.createHmac("sha256", secret).update(body).digest("hex")
        // Constant-time comparison to prevent timing attacks
        try {
            return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"))
        } catch {
            return false
        }
    }

    /**
     * Reset the cached key (for testing purposes).
     */
    export function _resetCache(): void {
        cachedKey = null
    }
}
