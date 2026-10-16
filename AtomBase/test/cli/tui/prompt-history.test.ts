import "../../preload"
import { expect, test } from "bun:test"
import { historyForDirectory } from "@tui/component/prompt/history"

test("prompt history selects only current directory and keeps its own last 50 entries", () => {
  const entries = Array.from({ length: 60 }, (_, index) => ({
    directory: index % 2 === 0 ? "/project/a" : "/project/b",
    input: `prompt-${index}`,
    parts: [],
  }))
  entries.push({ directory: "/project/a", input: "latest-a", parts: [] })

  expect(historyForDirectory(entries, "/project/a").at(-1)?.input).toBe("latest-a")
  expect(historyForDirectory(entries, "/project/a").every((entry) => entry.directory === "/project/a")).toBe(true)
  expect(historyForDirectory(entries, "/project/b").at(-1)?.input).toBe("prompt-59")
  expect(historyForDirectory(entries, "/project/c")).toEqual([])
})
