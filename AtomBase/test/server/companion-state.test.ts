import "../preload"
import { expect, test } from "bun:test"
import { ACTION_RESULT_TTL_MS, beginAction, cacheAction } from "@/server/companion/state"

test("active companion actions stay idempotent and bounded", () => {
  let time = Date.now() + ACTION_RESULT_TTL_MS
  const message = (index: number) => ({ device_id: "device_capacity_test", client_request_id: String(index) })
  expect(beginAction(message(0), time)).toBe("new")
  time += 31_000
  expect(beginAction(message(0), time)).toBe("active")
  for (let index = 1; index < 1000; index++) beginAction(message(index), time)
  expect(beginAction(message(999), time)).toBe("active")
  expect(beginAction(message(1000), time)).toBe("capacity")
  time += ACTION_RESULT_TTL_MS
  expect(beginAction(message(1000), time)).toBe("new")
  cacheAction(message(1000), { status: "ok" })
})
