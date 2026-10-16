import "../../preload"
import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { testRender } from "@opentui/solid"
import type { ScrollBoxRenderable } from "@opentui/core"
import { VirtualList } from "@tui/component/virtual-list"

test("tail following survives a temporarily clamped layout scroll", async () => {
  const [items, setItems] = createSignal(Array.from({ length: 100 }, (_, index) => `row ${index}`))
  let scroll: ScrollBoxRenderable | undefined
  const setup = await testRender(
    () => (
      <scrollbox ref={(value: ScrollBoxRenderable) => (scroll = value)} width={30} height={8} stickyScroll={false}>
        <VirtualList
          data={items()}
          scrollRef={() => scroll}
          itemKey={(item) => item}
          itemHeight={1}
          buffer={2}
          renderItem={(item) => <text>{item}</text>}
        />
      </scrollbox>
    ),
    { width: 30, height: 8 },
  )
  try {
    await setup.renderOnce()
    await Bun.sleep(40)
    await setup.renderOnce()
    expect(scroll).toBeDefined()
    expect(scroll!.scrollTop).toBeGreaterThan(0)

    const original = scroll!.scrollTo.bind(scroll)
    let clamped = false
    scroll!.scrollTo = (position) => {
      if (!clamped && typeof position === "number") {
        clamped = true
        return original(Math.max(0, position - 5))
      }
      return original(position)
    }
    setItems((previous) => [...previous, ...Array.from({ length: 10 }, (_, index) => `new ${index}`)])
    await setup.renderOnce()
    await Bun.sleep(80)
    await setup.renderOnce()

    expect(clamped).toBe(true)
    expect(scroll!.scrollTop).toBe(scroll!.scrollHeight - scroll!.viewport.height)
    expect(setup.captureCharFrame()).toContain("new 9")
  } finally {
    setup.renderer.destroy()
  }
})

test("scrolling upward renders earlier rows in a long transcript", async () => {
  const [items, setItems] = createSignal(Array.from({ length: 150 }, (_, index) => `row ${index}`))
  let scroll: ScrollBoxRenderable | undefined
  const setup = await testRender(
    () => (
      <scrollbox ref={(value: ScrollBoxRenderable) => (scroll = value)} width={30} height={8} stickyScroll={false}>
        <VirtualList
          data={items()}
          scrollRef={() => scroll}
          itemKey={(item) => item}
          itemHeight={1}
          buffer={2}
          renderItem={(item) => <text>{item}</text>}
        />
      </scrollbox>
    ),
    { width: 30, height: 8 },
  )
  try {
    await setup.renderOnce()
    await Bun.sleep(40)
    scroll!.scrollTo(0)
    await Bun.sleep(40)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("row 0")
    expect(setup.captureCharFrame()).not.toContain("row 149")
    setItems((previous) => [...previous, ...Array.from({ length: 25 }, (_, index) => `new ${index}`)])
    await Bun.sleep(40)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("row 0")
    expect(setup.captureCharFrame()).not.toContain("new 24")
  } finally {
    setup.renderer.destroy()
  }
})
