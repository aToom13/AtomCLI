import { describe, expect, test, beforeEach } from "bun:test"
import { CompanionAuth } from "@atomcli/companion"
import { createPrivateKey, createPublicKey, sign } from "node:crypto"

describe("CompanionAuth", () => {
    let validKeypair: { pubB64: string; privDer: Buffer }

    beforeEach(() => {
        // Generate an ED25519 keypair for testing
        // We need the raw 32-byte public key in base64 to simulate Flutter
        const { publicKey, privateKey } = globalThis.crypto.subtle.generateKey(
            { name: "Ed25519" },
            true,
            ["sign", "verify"]
        ) as any // bun test environment workaround

        // Create a keypair using node crypto
        const keyPair = require("node:crypto").generateKeyPairSync("ed25519")
        const pubDer = keyPair.publicKey.export({ format: "der", type: "spki" })

        // The raw 32 bytes are at the end of the SPKI DER structure
        const rawPub = pubDer.subarray(pubDer.length - 32)
        validKeypair = {
            pubB64: rawPub.toString("base64"),
            privDer: keyPair.privateKey,
        }
    })

    test("device registration", () => {
        const device = CompanionAuth.registerDevice("test_device", "dummy_pub_key")
        expect(device.deviceName).toBe("test_device")
        expect(device.publicKeyBase64).toBe("dummy_pub_key")
        expect(CompanionAuth.listDevices().length).toBeGreaterThan(0)
    })

    test("device removal", () => {
        CompanionAuth.registerDevice("remove_device", "dummy")
        expect(CompanionAuth.getDevice("remove_device")).toBeDefined()
        CompanionAuth.removeDevice("remove_device")
        expect(CompanionAuth.getDevice("remove_device")).toBeUndefined()
    })

    test("signature verification with raw keys", () => {
        const deviceName = "sig_device"
        CompanionAuth.registerDevice(deviceName, validKeypair.pubB64)

        const payload = '{"action":"allow","id":"req_1"}'

        // Sign payload
        const signatureBytes = sign(null, Buffer.from(payload), validKeypair.privDer)
        const signatureB64 = signatureBytes.toString("base64")

        // Verify valid expected signature
        const isValid = CompanionAuth.verify(deviceName, payload, signatureB64)
        expect(isValid).toBe(true)

        // Verify invalid payload
        const isInvalid = CompanionAuth.verify(deviceName, '{"action":"deny"}', signatureB64)
        expect(isInvalid).toBe(false)
    })

    describe("pairing tokens", () => {
        test("token consumption", () => {
            const token = CompanionAuth.issueToken()
            // First try should succeed
            expect(CompanionAuth.consumeToken(token)).toBe(true)
            // Second try should fail (single use)
            expect(CompanionAuth.consumeToken(token)).toBe(false)
        })

        test("expired tokens", async () => {
            const token = CompanionAuth.issueToken(10) // 10ms ttl
            await new Promise((r) => setTimeout(r, 20)) // wait 20ms
            expect(CompanionAuth.consumeToken(token)).toBe(false)
        })
    })
})
