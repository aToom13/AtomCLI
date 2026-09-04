import "../../preload"
import { describe, expect, test } from "bun:test"
import yargs from "yargs"
import { withNetworkOptions } from "@/interfaces/cli/network"

describe("network options", () => {
  test("selects the companion port automatically by default", async () => {
    const args = await withNetworkOptions(yargs([]).exitProcess(false)).parse()

    expect(args.companionPort).toBe(0)
  })

  test("preserves an explicitly selected companion port", async () => {
    const args = await withNetworkOptions(yargs(["--companion-port", "5096"]).exitProcess(false)).parse()

    expect(args.companionPort).toBe(5096)
  })
})
