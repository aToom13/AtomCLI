import "../../preload"
import { describe, expect, test } from "bun:test"
import yargs from "yargs"
import { companionIntent, needsControlListener, withNetworkOptions } from "@/interfaces/cli/network"

describe("network options", () => {
  test("keeps the internal TUI transport from taking the companion's preferred port", () => {
    expect(
      needsControlListener({
        portSet: false,
        hostnameSet: false,
        mdnsSet: false,
        mdns: false,
        port: 0,
        hostname: "127.0.0.1",
      }),
    ).toBe(false)
    expect(
      needsControlListener({
        portSet: true,
        hostnameSet: false,
        mdnsSet: false,
        mdns: false,
        port: 4096,
        hostname: "127.0.0.1",
      }),
    ).toBe(true)
  })
  test("selects the companion port automatically by default", async () => {
    const args = await withNetworkOptions(yargs([]).exitProcess(false)).parse()

    expect(args.companionPort).toBe(0)
  })

  test("preserves an explicitly selected companion port", async () => {
    const args = await withNetworkOptions(yargs(["--companion-port", "5096"]).exitProcess(false)).parse()

    expect(args.companionPort).toBe(5096)
  })

  test("starts the TUI companion listener without enabling pairing", () => {
    expect(companionIntent({ value: false, explicitlySet: false, pairedDevices: false, autoStart: true })).toEqual({
      enabled: true,
      pairing: false,
    })
  })

  test("an explicit no-companion overrides automatic startup and paired devices", () => {
    expect(companionIntent({ value: false, explicitlySet: true, pairedDevices: true, autoStart: true })).toEqual({
      enabled: false,
      pairing: false,
    })
  })

  test("an explicit companion request enables both listener and pairing", () => {
    expect(companionIntent({ value: true, explicitlySet: true, pairedDevices: false, autoStart: true })).toEqual({
      enabled: true,
      pairing: true,
    })
  })
})
