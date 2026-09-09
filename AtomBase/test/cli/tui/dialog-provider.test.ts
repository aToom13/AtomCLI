import "../../preload"
import { describe, expect, test } from "bun:test"
import { ProviderDialog } from "@tui/component/dialog-provider"

describe("provider dialog", () => {
  test("includes auth-only providers such as Cline", () => {
    const providers = ProviderDialog.available([], {
      cline: [{ type: "oauth", label: "Cline (Browser login)" }],
    })

    expect(providers).toHaveLength(1)
    expect(providers[0]).toMatchObject({ id: "cline", name: "Cline", models: {} })
  })

  test("does not duplicate providers already present in catalog", () => {
    const existing = {
      id: "cline",
      name: "Cline Cloud",
      env: [],
      models: {},
    }
    const providers = ProviderDialog.available([existing], {
      cline: [{ type: "oauth", label: "Cline (Browser login)" }],
    })

    expect(providers).toEqual([existing])
  })
})
