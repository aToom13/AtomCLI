import "../../preload"
import { expect, spyOn, test } from "bun:test"
import { createStore } from "solid-js/store"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import * as Sync from "@tui/context/sync"
import * as Local from "@tui/context/local"
import * as SDK from "@tui/context/sdk"
import * as Dialog from "@tui/ui/dialog"
import * as Toast from "@tui/ui/toast"
import * as Theme from "@tui/context/theme"
import { KeybindProvider } from "@tui/context/keybind"
import { SpatialProvider } from "@tui/context/spatial"
import { DialogRouterProfile } from "@tui/component/dialog-autoconf"

for (const profile of ["auto", "free"] as const) {
  test(`${profile} routing settings: keyboard selection saves only its own profile`, async () => {
    const [data, set] = createStore({
      config: {
        keybinds: {},
        experimental: {
          auto_router: { mode: "speed", allowed_providers: ["atomcli", "example"] },
          free_router: { mode: "quality" },
        },
      },
      provider: [
        { id: "atomcli", name: "AtomCLI", models: { same: { name: "Shared" } } },
        { id: "example", name: "Example", models: { same: { name: "Shared" } } },
      ],
    })
    const updates: any[] = []
    const errors: any[] = []
    const color = RGBA.fromInts(128, 128, 128)
    const theme = {
      text: color,
      textMuted: color,
      background: color,
      backgroundPanel: color,
      primary: color,
      accent: color,
    }
    const spies = [
      spyOn(Sync, "useSync").mockReturnValue({ data, set } as any),
      spyOn(Local, "useLocal").mockReturnValue({ model: { set() {} } } as any),
      spyOn(SDK, "useSDK").mockReturnValue({
        client: {
          config: {
            update: async (payload: any) => {
              updates.push(payload)
            },
          },
        },
      } as any),
      spyOn(Dialog, "useDialog").mockReturnValue({ setSize() {}, clear() {} } as any),
      spyOn(Toast, "useToast").mockReturnValue({
        show: (entry: any) => {
          if (entry.variant === "error") errors.push(entry)
        },
      } as any),
      spyOn(Theme, "useTheme").mockReturnValue({ theme } as any),
    ]
    const setup = await testRender(
      () => (
        <KeybindProvider>
          <SpatialProvider>
            <DialogRouterProfile profile={profile} />
          </SpatialProvider>
        </KeybindProvider>
      ),
      { width: 150, height: 50 },
    )
    try {
      await Bun.sleep(10)
      await setup.renderOnce()
      expect(setup.captureCharFrame()).toContain(profile === "free" ? "AtomCLI Free settings" : "AtomCLI Auto settings")
      if (profile === "free") expect(setup.captureCharFrame()).not.toContain("example/same")
      const query = profile === "auto" ? "Example (example)" : "atomcli/same"
      await setup.mockInput.typeText(query)
      await setup.renderOnce()
      setup.mockInput.pressEnter()
      await setup.renderOnce()
      if (profile === "free") expect(setup.captureCharFrame()).toContain("[ ] Shared")
      for (let i = 0; i < query.length; i++) setup.mockInput.pressBackspace()
      await setup.mockInput.typeText("Save")
      await setup.renderOnce()
      setup.mockInput.pressEnter()
      await Bun.sleep(20)
      expect(errors).toEqual([])
      expect(updates).toHaveLength(1)
      const key = `${profile}_router`
      expect(Object.keys(updates[0].experimental)).toEqual([key])
      if (profile === "auto") {
        expect(updates[0].experimental.auto_router.allowed_providers).toEqual(["atomcli"])
        expect(data.config.experimental.free_router).toEqual({ mode: "quality" })
      } else {
        expect(updates[0].experimental.free_router.excluded_models).toEqual(["atomcli/same"])
        expect(updates[0].experimental.free_router.allowed_providers).toBeUndefined()
        expect(updates[0].experimental.free_router.allow_paid_models).toBeUndefined()
        expect(data.config.experimental.auto_router).toEqual({
          mode: "speed",
          allowed_providers: ["atomcli", "example"],
        })
      }
    } finally {
      setup.renderer.destroy()
      for (const spy of spies.reverse()) spy.mockRestore()
    }
  })
}
