import "../../preload"
import { expect, mock, spyOn, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import * as Sync from "@tui/context/sync"
import * as Local from "@tui/context/local"
import * as SDK from "@tui/context/sdk"
import * as Route from "@tui/context/route"
import * as Exit from "@tui/context/exit"
import * as KV from "@tui/context/kv"
import * as Dialog from "@tui/ui/dialog"
import * as Toast from "@tui/ui/toast"
import * as Theme from "@tui/context/theme"
import * as History from "@tui/component/prompt/history"
import * as Stash from "@tui/component/prompt/stash"
import * as Command from "@tui/component/dialog-command"
import * as Autocomplete from "@tui/component/prompt/autocomplete"
import { KeybindProvider } from "@tui/context/keybind"
import { Prompt, type PromptRef } from "@tui/component/prompt"

test("first prompt submits once, keeps its draft on session failure and can retry", async () => {
  let creation = Promise.withResolvers<any>()
  const create = mock(() => creation.promise)
  const prompt = mock(async (_payload: any) => ({ data: {} }))
  const append = mock((_entry: History.PromptInfo) => {})
  const errors: any[] = []
  const color = RGBA.fromInts(128, 128, 128)
  const theme = new Proxy({}, { get: () => color })
  const spies = [
    spyOn(Sync, "useSync").mockReturnValue({
      data: { config: { keybinds: {} }, provider: [], command: [], message: {} },
      optimistic: { push() {}, settle() {} },
    } as any),
    spyOn(Local, "useLocal").mockReturnValue({
      agent: { current: () => ({ name: "agent" }), color: () => color },
      model: {
        current: () => ({ providerID: "atomcli", modelID: "free" }),
        parsed: () => ({ provider: "AtomCLI", model: "Free" }),
        pinned: () => false,
        variant: { current() {}, list: () => [], pinned: () => false },
      },
    } as any),
    spyOn(SDK, "useSDK").mockReturnValue({
      event: { on() {} },
      client: { session: { create, prompt } },
    } as any),
    spyOn(Route, "useRoute").mockReturnValue({ navigate() {} } as any),
    spyOn(Exit, "useExit").mockReturnValue((() => {}) as any),
    spyOn(KV, "useKV").mockReturnValue({ get: (_: string, value: unknown) => value } as any),
    spyOn(Dialog, "useDialog").mockReturnValue({} as any),
    spyOn(Toast, "useToast").mockReturnValue({ show: (entry: any) => errors.push(entry) } as any),
    spyOn(Theme, "useTheme").mockReturnValue({ theme, syntax: () => ({ getStyleId: () => 1 }) } as any),
    spyOn(History, "usePromptHistory").mockReturnValue({ append } as any),
    spyOn(Stash, "usePromptStash").mockReturnValue({} as any),
    spyOn(Command, "useCommandDialog").mockReturnValue({ register() {} } as any),
    spyOn(Autocomplete, "Autocomplete").mockImplementation((props) => {
      props.ref({ visible: false, onInput() {}, onKeyDown() {} } as any)
      return null
    }),
  ]
  let ref: PromptRef
  let setup: Awaited<ReturnType<typeof testRender>>
  try {
    setup = await testRender(
      () => (
        <KeybindProvider>
          <Prompt ref={(value) => (ref = value)} />
        </KeybindProvider>
      ),
      { width: 100, height: 24 },
    )
    await setup.renderOnce()
    await setup.mockInput.typeText("selam")
    setup.mockInput.pressEnter()
    setup.mockInput.pressEnter()
    await setup.renderOnce()
    expect(create).toHaveBeenCalledTimes(1)
    expect(prompt).not.toHaveBeenCalled()

    creation.reject(new Error("fake session creation failure"))
    await Bun.sleep(10)
    expect(ref!.current.input).toBe("selam")
    expect(errors).toMatchObject([{ title: "Session creation failed", message: "fake session creation failure" }])

    creation = Promise.withResolvers<any>()
    setup.mockInput.pressEnter()
    setup.mockInput.pressEnter()
    await setup.renderOnce()
    expect(create).toHaveBeenCalledTimes(2)
    creation.resolve({ data: { id: "ses_first_prompt" } })
    await Bun.sleep(60)
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(prompt.mock.calls[0][0].parts).toEqual([expect.objectContaining({ type: "text", text: "selam" })])
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ input: "selam" }))
    expect(ref!.current.input).toBe("")
  } finally {
    setup?.renderer.destroy()
    for (const spy of spies.reverse()) spy.mockRestore()
  }
})
