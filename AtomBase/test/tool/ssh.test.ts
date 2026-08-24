import "../preload"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import z from "zod"
import type { PermissionNext } from "@/util/permission/next"
import { Config } from "@/core/config/config"
import { Global } from "@/core/global"
import { RemoteProfileStore } from "@/integrations/remote/profile-store"
import { ToolRegistry } from "@/integrations/tool/registry"
import { SshTool } from "@/integrations/tool/ssh"
import { Instance } from "@/services/project/instance"
import { createSshTestServer } from "./fixtures/ssh-server"

type Request = Omit<PermissionNext.Request, "id" | "sessionID" | "tool">

let projectDirectory: string
let remoteDirectory: string
let server: Awaited<ReturnType<typeof createSshTestServer>>
let previousGlobalConfig: string | undefined
const MANAGED_PROFILE = "test-user"

function context(requests: Request[] = []) {
  return {
    sessionID: "ses_remote_test",
    messageID: "msg_remote_test",
    callID: "call_remote_test",
    agent: "build",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async (request: Request) => {
      requests.push(request)
    },
  }
}

async function writeGlobalProfile(hostKey?: string) {
  await fs.mkdir(Global.Path.config, { recursive: true })
  await fs.writeFile(
    path.join(Global.Path.config, "atomcli.jsonc"),
    JSON.stringify({
      $schema: "https://atomcli.ai/config.json",
      remote: {
        hosts: {
          fixture: {
            host: server.host,
            port: server.port,
            username: server.username,
            password: server.password,
            ...(hostKey ? { hostKey } : {}),
          },
        },
      },
    }),
  )
  await Config.clearCache()
}

async function execute(
  input: Parameters<Awaited<ReturnType<typeof SshTool.init>>["execute"]>[0],
  requests: Request[] = [],
) {
  return Instance.provide({
    directory: projectDirectory,
    fn: async () => {
      const tool = await SshTool.init()
      return tool.execute(input, context(requests))
    },
  })
}

beforeAll(async () => {
  projectDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "atomcli-remote-project-"))
  remoteDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "atomcli-remote-host-"))
  previousGlobalConfig = await fs
    .readFile(path.join(Global.Path.config, "atomcli.jsonc"), "utf8")
    .catch(() => undefined)
  await fs.writeFile(path.join(remoteDirectory, "hello.txt"), "hello over sftp")
  server = await createSshTestServer(remoteDirectory)
  await writeGlobalProfile()
})

afterAll(async () => {
  await RemoteProfileStore.remove(MANAGED_PROFILE).catch(() => {})
  await Instance.provide({
    directory: projectDirectory,
    fn: async () => Instance.dispose(),
  }).catch(() => {})
  await server.close()
  const globalConfigPath = path.join(Global.Path.config, "atomcli.jsonc")
  if (previousGlobalConfig === undefined) await fs.rm(globalConfigPath, { force: true })
  else await fs.writeFile(globalConfigPath, previousGlobalConfig)
  await Config.clearCache()
  await fs.rm(projectDirectory, { recursive: true, force: true })
  await fs.rm(remoteDirectory, { recursive: true, force: true })
})

describe("tool.ssh", () => {
  test("is always registered as a system tool with a provider-compatible object schema", async () => {
    const tool = await SshTool.init()
    const jsonSchema = z.toJSONSchema(tool.parameters) as { type?: string; anyOf?: unknown[] }

    const toolIDs = await Instance.provide({
      directory: projectDirectory,
      fn: () => ToolRegistry.ids(),
    })
    expect(toolIDs.filter((id) => id === "ssh")).toEqual(["ssh"])
    expect(tool.description).toContain(`fixture: ${server.username}@${server.host}:${server.port}`)
    expect(jsonSchema.type).toBe("object")
    expect(jsonSchema.anyOf).toBeUndefined()
    expect(tool.parameters.safeParse({ host: "fixture", action: "exec" }).success).toBe(false)
    expect(
      tool.parameters.safeParse({ host: "fixture", action: "exec", command: "pwd", connectTimeout: 30_000 }).success,
    ).toBe(true)
    expect(tool.parameters.safeParse({ action: "profile_list" }).success).toBe(true)
    expect(tool.parameters.safeParse({ action: "profile_add", host: "missing-details" }).success).toBe(false)
    expect(
      tool.parameters.safeParse({
        action: "profile_add",
        host: "unsafe:profile",
        hostname: "example.com",
        username: "user",
        password: "secret",
      }).success,
    ).toBe(false)
    expect(tool.parameters.safeParse({ host: "fixture", action: "read", command: "pwd" }).success).toBe(false)
    expect(tool.parameters.safeParse({ host: "fixture", action: "write", path: "/x", content: "ok" }).success).toBe(
      true,
    )
  })

  test("manages encrypted profiles without reading or editing config", async () => {
    await RemoteProfileStore.remove(MANAGED_PROFILE).catch(() => {})
    const requests: Request[] = []

    await expect(
      execute({
        action: "profile_add",
        host: "fixture",
        hostname: server.host,
        port: server.port,
        username: server.username,
        password: server.password,
      }),
    ).rejects.toThrow("overwrite=true")

    const added = await execute(
      {
        action: "profile_add",
        hostname: server.host,
        port: server.port,
        username: server.username,
        password: server.password,
        overwrite: true,
      },
      requests,
    )
    expect(added.output).toContain("available immediately")
    expect(requests[0].patterns).toEqual(["*"])
    expect(JSON.stringify(requests[0])).not.toContain(server.password)

    const stored = await fs.readFile(path.join(Global.Path.data, "ssh-profiles.json"), "utf8")
    expect(stored.startsWith("ATOMCLI_ENC:")).toBe(true)
    expect(stored).not.toContain(server.password)

    const listed = await execute({ action: "profile_list" })
    expect(listed.output).toContain(`${MANAGED_PROFILE}\t${server.username}@${server.host}:${server.port}`)
    expect(listed.output).not.toContain(server.password)

    const executed = await execute({ action: "exec", host: MANAGED_PROFILE, command: "printf 'managed-ok'" }, requests)
    expect(executed.output).toBe("managed-ok")
    expect((await RemoteProfileStore.managed())[MANAGED_PROFILE].hostKey).toMatch(/^SHA256:/)

    await execute({ action: "profile_remove", host: MANAGED_PROFILE }, requests)
    await expect(execute({ action: "exec", host: MANAGED_PROFILE, command: "printf 'never'" })).rejects.toThrow(
      "Use action=profile_add",
    )
  })

  test("executes through SSH and offers whole-tool always permission", async () => {
    const requests: Request[] = []
    const result = await execute(
      { host: "fixture", action: "exec", command: "printf 'remote-ok'", description: "Print remote marker" },
      requests,
    )

    expect(result.output).toBe("remote-ok")
    expect(result.metadata.exit).toBe(0)
    expect(result.metadata.output).toBe("remote-ok")
    expect(result.metadata.target).toBe(`${server.username}@${server.host}:${server.port}`)
    expect(requests[0].permission).toBe("ssh")
    expect(requests[0].patterns).toEqual(["*"])
    expect(requests[0].always).toEqual(["*"])
    const hostKey = requests.find((request) => request.patterns[0].startsWith("fixture:hostkey:SHA256:"))
    expect(hostKey).toBeDefined()
  })

  test("supports the V1 SFTP actions over the pooled connection", async () => {
    expect((await execute({ host: "fixture", action: "read", path: "/hello.txt" })).output).toBe("hello over sftp")

    await execute({ host: "fixture", action: "mkdir", path: "/nested/child" })
    await execute({ host: "fixture", action: "write", path: "/nested/child/value.txt", content: "written remotely" })
    const listed = await execute({ host: "fixture", action: "list", path: "/nested/child" })
    expect(listed.output).toContain("value.txt")

    const stat = await execute({ host: "fixture", action: "stat", path: "/nested/child/value.txt" })
    expect(stat.output).toContain("type: file")
    expect(stat.output).toContain("size: 16")

    await execute({ host: "fixture", action: "remove", path: "/nested", recursive: true })
    await expect(fs.stat(path.join(remoteDirectory, "nested"))).rejects.toThrow()
  })

  test("retries transient handshake failures without another tool call", async () => {
    const retryProfile = "fixture-retry"
    const retryServer = await createSshTestServer(remoteDirectory, { dropConnections: 1 })
    try {
      await execute({
        action: "profile_add",
        host: retryProfile,
        hostname: retryServer.host,
        port: retryServer.port,
        username: retryServer.username,
        password: retryServer.password,
        connectTimeout: 500,
        overwrite: true,
      })
      const result = await execute({ action: "exec", host: retryProfile, command: "printf 'retry-ok'" })
      expect(result.output).toBe("retry-ok")
      expect(retryServer.connectionAttempts).toBe(2)
    } finally {
      await RemoteProfileStore.remove(retryProfile).catch(() => {})
      await retryServer.close()
    }
  })

  test("ignores project-defined credential profiles", async () => {
    await fs.writeFile(
      path.join(projectDirectory, "atomcli.jsonc"),
      JSON.stringify({
        $schema: "https://atomcli.ai/config.json",
        remote: {
          hosts: {
            fixture: { host: "attacker.invalid", port: 22, username: "attacker", password: "attacker" },
            injected: { host: "attacker.invalid", port: 22, username: "attacker", password: "attacker" },
          },
        },
      }),
    )
    await Config.clearCache()
    const hosts = await Config.remoteHosts()
    const mergedHosts = await Instance.provide({
      directory: projectDirectory,
      fn: async () => (await Config.get()).remote?.hosts ?? {},
    })
    expect(hosts.fixture.host).toBe("127.0.0.1")
    expect(hosts.injected).toBeUndefined()
    expect(mergedHosts.fixture.host).toBe("127.0.0.1")
    expect(mergedHosts.injected).toBeUndefined()
  })

  test("fails closed when a pinned host key does not match", async () => {
    await writeGlobalProfile("SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
    await expect(execute({ host: "fixture", action: "exec", command: "printf 'never'" })).rejects.toThrow(
      "SSH host key mismatch",
    )
    await writeGlobalProfile()
  })
})
