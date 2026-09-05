import { afterEach, describe, expect, test } from "bun:test"
import "../preload"
import { Server } from "@/server/server"
import { ServerSecurity } from "@/server/security"
import { Installation } from "@/services/installation"

const servers: Array<ReturnType<typeof Server.listen>> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)))
})

describe("control-plane security", () => {
  test("uses the binary version in the generated API contract", async () => {
    const specification = await Server.openapi()
    expect(specification.info.version).toBe(Installation.VERSION)
  })
  test("refuses a non-loopback bind without authentication", () => {
    expect(() => Server.listen({ hostname: "0.0.0.0", port: 0 })).toThrow("without --auth")
  })

  test("requires bearer authentication for sensitive HTTP routes", async () => {
    const server = Server.listen({ hostname: "127.0.0.1", port: 0, auth: "test-control-token" })
    servers.push(server)
    const base = `http://127.0.0.1:${server.port}`

    for (const path of ["/pty", "/file", "/config", "/session"]) {
      const unauthorized = await fetch(base + path)
      expect(unauthorized.status).toBe(401)
    }

    const authorized = await fetch(base + "/__auth_probe__", {
      headers: { authorization: "Bearer test-control-token" },
    })
    expect(authorized.status).toBe(404)
  })

  test("rejects rebinding hosts and mismatched browser origins", () => {
    const badHost = ServerSecurity.reject(new Request("http://evil.example/pty"), {})
    expect(badHost?.status).toBe(403)

    const foreignIpHost = ServerSecurity.reject(new Request("http://203.0.113.10/pty"), {
      allowedHosts: ["127.0.0.1"],
    })
    expect(foreignIpHost?.status).toBe(403)

    const lanIpOnWildcard = ServerSecurity.reject(new Request("http://192.168.1.50/pty"), {
      allowedHosts: ["0.0.0.0"],
    })
    expect(lanIpOnWildcard).toBeUndefined()

    const badOrigin = ServerSecurity.reject(
      new Request("http://127.0.0.1:4096/pty", {
        headers: { host: "127.0.0.1:4096", origin: "https://evil.example" },
      }),
      {},
    )
    expect(badOrigin?.status).toBe(403)

    const officialOrigin = ServerSecurity.reject(
      new Request("http://127.0.0.1:4096/pty", {
        headers: { host: "127.0.0.1:4096", origin: "https://app.atomcli.ai" },
      }),
      {},
    )
    expect(officialOrigin).toBeUndefined()
  })
})
