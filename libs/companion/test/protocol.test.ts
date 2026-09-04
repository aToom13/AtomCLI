import { describe, expect, test } from "bun:test"
import { CompanionProtocol } from "../src/protocol"

describe("CompanionProtocol", () => {
  test("shared contract fixtures parse and canonicalize identically", async () => {
    const fixtures = await Bun.file(new URL("../protocol/contract-fixtures.json", import.meta.url)).json()
    expect(CompanionProtocol.AuthChallenge.parse(fixtures.authChallenge)).toEqual(fixtures.authChallenge)
    expect(CompanionProtocol.InboundMessage.parse(fixtures.signedMutation.message).type).toBe("pause_session")
    const { signature: _signature, device_name: _deviceName, ...payload } = fixtures.signedMutation.message
    const canonical = JSON.stringify(
      Object.fromEntries(
        Object.keys(payload)
          .sort()
          .map((key) => [key, payload[key]]),
      ),
    )
    expect(canonical).toBe(fixtures.signedMutation.canonical)
  })

  test("accepts protocol v2 through the current version", () => {
    expect(CompanionProtocol.negotiateVersion(1)).toBeUndefined()
    expect(CompanionProtocol.negotiateVersion(2)).toBe(2)
    expect(CompanionProtocol.negotiateVersion(CompanionProtocol.CURRENT_VERSION)).toBe(
      CompanionProtocol.CURRENT_VERSION,
    )
    expect(CompanionProtocol.negotiateVersion(CompanionProtocol.CURRENT_VERSION + 1)).toBeUndefined()
  })

  test("negotiates only capabilities declared by the shared schema", () => {
    expect(CompanionProtocol.negotiateCapabilities(["core.sync", "future.unknown", "identity.v1"])).toEqual([
      "core.sync",
      "identity.v1",
    ])
    expect(CompanionProtocol.negotiateCapabilities()).toEqual([])
  })

  test("validates enhanced authentication and distinct peer identities", () => {
    const authentication = CompanionProtocol.InboundMessage.parse({
      type: "authenticate",
      challenge: crypto.randomUUID(),
      timestamp: Date.now(),
      device_name: "Galaxy",
      device_id: "phone-installation-1",
      protocol_version: CompanionProtocol.CURRENT_VERSION,
      capabilities: ["core.sync", "identity.v1"],
      signature: "signature",
    })
    expect(authentication.type).toBe("authenticate")
    if (authentication.type === "authenticate") expect(authentication.device_id).toBe("phone-installation-1")

    const identity = CompanionProtocol.PeerIdentity.parse({
      machine_id: crypto.randomUUID(),
      process_id: crypto.randomUUID(),
      bridge_id: crypto.randomUUID(),
      machine_name: "workstation",
      project_directory: "/code/atomcli",
    })
    expect(new Set([identity.machine_id, identity.process_id, identity.bridge_id]).size).toBe(3)
    expect(identity.project_directory).toBe("/code/atomcli")
  })

  test("keeps legacy sequence and epoch-aware cursors compatible", () => {
    expect(
      CompanionProtocol.SyncMessage.parse({
        type: "sync",
        last_seq_id: 42,
        bridge_epoch: crypto.randomUUID(),
      }).last_seq_id,
    ).toBe(42)

    const cursor = { bridge_epoch: crypto.randomUUID(), seq_id: 9 }
    expect(CompanionProtocol.EventCursor.parse(cursor)).toEqual(cursor)
  })

  test("validates signed Mission Control pause actions", () => {
    expect(CompanionProtocol.CAPABILITIES).toContain("missions.control")
    const message = CompanionProtocol.InboundMessage.parse({
      type: "pause_session",
      session_id: "ses_parent",
      directory: "/code/project",
      signature: "signature",
      device_name: "Galaxy",
      connection_id: crypto.randomUUID(),
      counter: 1,
      timestamp: Date.now(),
    })
    expect(message.type).toBe("pause_session")
  })

  test("validates signed session deletion actions", () => {
    const message = CompanionProtocol.InboundMessage.parse({
      type: "delete_session",
      session_id: "ses_history",
      directory: "/code/project",
      signature: "signature",
      device_name: "Galaxy",
      connection_id: crypto.randomUUID(),
      counter: 2,
      timestamp: Date.now(),
    })
    expect(message.type).toBe("delete_session")
  })

  test("negotiates Preview 2.0 and validates signed access refreshes", () => {
    expect(CompanionProtocol.CAPABILITIES).toContain("previews.v2")
    const message = CompanionProtocol.InboundMessage.parse({
      type: "preview_access",
      preview_id: "preview_test",
      directory: "/code/project",
      signature: "signature",
      device_name: "Galaxy",
      connection_id: crypto.randomUUID(),
      counter: 2,
      timestamp: Date.now(),
    })
    expect(message.type).toBe("preview_access")
  })

  test("negotiates resumable transfers and validates explicit inbox deletion", () => {
    expect(CompanionProtocol.CAPABILITIES).toContain("transfers.v2")
    const upload = CompanionProtocol.InboundMessage.parse({
      type: "create_upload",
      session_id: "session_test",
      filename: "archive.zip",
      mime: "application/zip",
      size: 42,
      sha256: "a".repeat(64),
      signature: "signature",
      device_name: "Galaxy",
      connection_id: crypto.randomUUID(),
      counter: 3,
      timestamp: Date.now(),
    })
    expect(upload.type).toBe("create_upload")
    const deletion = CompanionProtocol.InboundMessage.parse({
      type: "artifact_delete",
      artifact_id: "artifact_test",
      signature: "signature",
      device_name: "Galaxy",
      connection_id: crypto.randomUUID(),
      counter: 4,
      timestamp: Date.now(),
    })
    expect(deletion.type).toBe("artifact_delete")
  })
})
