import "../../preload"
import { describe, expect, test } from "bun:test"
import { For } from "solid-js"
import { testRender } from "@opentui/solid"
import type { ScrollBoxRenderable } from "@opentui/core"
import { SessionLayout } from "@tui/routes/session/layout"
import { Chain } from "@/integrations/agent/chain"

describe("ChainWidget task viewport", () => {
  test("preserves stable task IDs and follows a specifically activated step", () => {
    let chain = Chain.create()
    for (let index = 0; index < 14; index++) {
      chain = Chain.addStep(chain, { id: `step-${index}`, name: `Step ${index}`, description: `Step ${index}` })
    }

    chain = Chain.updateStepAtIndex(chain, 7, "running")
    expect(chain.steps[7].id).toBe("step-7")
    expect(chain.currentStep).toBe(7)
    expect(chain.status).toBe("executing")
  })

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
                  <text wrapMode="none">
                    {index() + 1}. {task}
                  </text>
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

  test("moves a measured five-row viewport around the active task", async () => {
    const tasks = Array.from({ length: 14 }, (_, index) => `Task ${index + 1}`)
    let taskList: ScrollBoxRenderable | undefined

    function TaskViewport() {
      return (
        <scrollbox
          ref={(renderable: ScrollBoxRenderable) => (taskList = renderable)}
          width={32}
          height={5}
          contentOptions={SessionLayout.chainScrollContentOptions}
          verticalScrollbarOptions={{ visible: true }}
          horizontalScrollbarOptions={{ visible: false }}
          scrollX={false}
        >
          <For each={tasks}>
            {(task, index) => (
              <box height={1} flexShrink={0}>
                <text wrapMode="none">
                  {index() + 1}. {task}
                </text>
              </box>
            )}
          </For>
        </scrollbox>
      )
    }

    const setup = await testRender(TaskViewport, { width: 32, height: 5 })
    try {
      await setup.renderOnce()
      const target = SessionLayout.chainCenteredScrollOffset(
        Array.from({ length: tasks.length }, () => 1),
        7,
        5,
      )
      taskList?.scrollTo(target)
      await setup.renderOnce()

      const frame = setup.captureCharFrame()
      expect(taskList?.scrollTop).toBe(5)
      for (let task = 6; task <= 10; task++) expect(frame).toContain(`${task}. Task ${task}`)
      expect(frame).not.toContain("1. Task 1 ")
      expect(frame).not.toContain("11. Task 11")
    } finally {
      setup.renderer.destroy()
    }
  })
})
