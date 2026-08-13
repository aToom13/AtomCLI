import { describe, expect, test } from "bun:test"
import { Server } from "@/server/server"

describe("removed dashboard", () => {
  test.each(["/dashboard", "/dashboard/", "/dashboard/js/main.js"])("returns 404 for %s", async (path) => {
    const response = await Server.App().request(path)
    expect(response.status).toBe(404)
  })

  test("keeps the headless server API available", async () => {
    const response = await Server.App().request("/global/health")
    expect(response.status).toBe(200)
  })
})
