import { describe, expect, test } from "bun:test"
import { For } from "solid-js"
import { testRender } from "@opentui/solid"
import { SessionLayout } from "@tui/routes/session/layout"

describe("ChainWidget task viewport", () => {
  test("renders every task row when the plan fits without a scrollbar", async () => {
    const tasks = [
      "Ortam ve bağımlılık kontrolü",
      "Test dosyalarının taranması",
      "Yerleşim düzeltmesi",
      "Regresyon testi",
      "Son doğrulama",
    ]
    const height = SessionLayout.chainExpandedHeight(26, tasks.length)

    function TaskViewport() {
      return (
        <box width={64} height={height} border={["bottom"]}>
          <scrollbox
            width="100%"
            height="100%"
            contentOptions={SessionLayout.chainScrollContentOptions}
            verticalScrollbarOptions={{
              visible: SessionLayout.chainNeedsScrollbar(26, height, tasks.length),
            }}
            horizontalScrollbarOptions={{ visible: false }}
            scrollX={false}
          >
            <For each={tasks}>
              {(task, index) => (
                <box height={1} flexShrink={0} overflow="hidden">
                  <text wrapMode="none">{index() + 1}. {task}</text>
                </box>
              )}
            </For>
          </scrollbox>
        </box>
      )
    }

    const setup = await testRender(TaskViewport, { width: 64, height: 8 })
    try {
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      for (let index = 0; index < tasks.length; index++) {
        expect(frame).toContain(`${index + 1}. ${tasks[index]}`)
      }
      expect(frame).not.toContain("█")
    } finally {
      setup.renderer.destroy()
    }
  })
})
