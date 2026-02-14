import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Crypto } from "../../src/util/crypto"
import fs from "fs/promises"
import path from "path"
import os from "os"

describe("util.crypto", () => {
    let originalHome: string | undefined

    beforeEach(async () => {
        // Isolate tests by using a temp home directory
        originalHome = process.env.ATOMCLI_TEST_HOME
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomcli-crypto-test-"))
        process.env.ATOMCLI_TEST_HOME = tmpDir
        await fs.mkdir(path.join(tmpDir, ".atomcli", "data"), { recursive: true })
        Crypto._resetCache()
    })

    afterEach(async () => {
        if (originalHome !== undefined) {
            process.env.ATOMCLI_TEST_HOME = originalHome
        } else {
            delete process.env.ATOMCLI_TEST_HOME
        }
        Crypto._resetCache()
    })

    test("encrypt and decrypt roundtrip", async () => {
        const plaintext = "hello world, this is a secret!"
        const encrypted = await Crypto.encrypt(plaintext)

        expect(encrypted).not.toBe(plaintext)
        expect(Crypto.isEncrypted(encrypted)).toBe(true)

        const decrypted = await Crypto.decrypt(encrypted)
        expect(decrypted).toBe(plaintext)
    })

    test("encryptJSON and decryptJSON roundtrip", async () => {
        const obj = { key: "value", nested: { a: 1, b: [1, 2, 3] } }
        const encrypted = await Crypto.encryptJSON(obj)

        expect(Crypto.isEncrypted(encrypted)).toBe(true)

        const decrypted = await Crypto.decryptJSON(encrypted)
        expect(decrypted).toEqual(obj)
    })

    test("decrypt returns plaintext as-is for backward compatibility", async () => {
        const plaintext = '{"type":"api","key":"sk-test-123"}'
        const result = await Crypto.decrypt(plaintext)
        expect(result).toBe(plaintext)
    })

    test("isEncrypted detects encrypted vs plaintext data", () => {
        expect(Crypto.isEncrypted("ATOMCLI_ENC:abc123")).toBe(true)
        expect(Crypto.isEncrypted('{"key":"value"}')).toBe(false)
        expect(Crypto.isEncrypted("")).toBe(false)
        expect(Crypto.isEncrypted("plain text")).toBe(false)
    })

    test("decrypt fails gracefully with corrupted encrypted data", async () => {
        const corrupted = "ATOMCLI_ENC:corrupted_base64_data"
        await expect(Crypto.decrypt(corrupted)).rejects.toThrow()
    })

    test("each encryption produces different ciphertext (unique IV)", async () => {
        const plaintext = "same input"
        const enc1 = await Crypto.encrypt(plaintext)
        const enc2 = await Crypto.encrypt(plaintext)

        // Different IVs should produce different ciphertext
        expect(enc1).not.toBe(enc2)

        // But both should decrypt to the same value
        expect(await Crypto.decrypt(enc1)).toBe(plaintext)
        expect(await Crypto.decrypt(enc2)).toBe(plaintext)
    })

    test("verifyHMAC validates correct signature", () => {
        const body = '{"config":{"model":"test"}}'
        const secret = "my-shared-secret"

        // Compute the expected HMAC
        const crypto = require("crypto")
        const expected = crypto.createHmac("sha256", secret).update(body).digest("hex")

        expect(Crypto.verifyHMAC(body, expected, secret)).toBe(true)
    })

    test("verifyHMAC rejects invalid signature", () => {
        const body = '{"config":{"model":"test"}}'
        const secret = "my-shared-secret"

        expect(Crypto.verifyHMAC(body, "invalid-hex-signature", secret)).toBe(false)
    })

    test("verifyHMAC rejects tampered body", () => {
        const body = '{"config":{"model":"test"}}'
        const secret = "my-shared-secret"

        const crypto = require("crypto")
        const sig = crypto.createHmac("sha256", secret).update(body).digest("hex")

        // Tamper with the body
        const tampered = '{"config":{"model":"malicious"}}'
        expect(Crypto.verifyHMAC(tampered, sig, secret)).toBe(false)
    })
})
