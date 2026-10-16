import "../preload"
import { test, expect, describe, mock } from "bun:test"
import { Config } from "@/core/config/config"
import { ConfigSchema } from "@/core/config/schema"
import { Instance } from "@/services/project/instance"
import { Auth } from "@/services/auth"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"
import { pathToFileURL } from "url"

test("migrates mixed legacy tools config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "atomcli.json"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
          agent: {
            test: {
              tools: {
                bash: true,
                write: true,
                read: false,
                webfetch: true,
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.agent?.["test"]?.permission).toEqual({
        bash: "allow",
        edit: "allow",
        read: "deny",
        webfetch: "allow",
      })
    },
  })
})

test("merges legacy tools with existing permission config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "atomcli.json"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
          agent: {
            test: {
              permission: {
                glob: "allow",
              },
              tools: {
                bash: true,
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.agent?.["test"]?.permission).toEqual({
        glob: "allow",
        bash: "allow",
      })
    },
  })
})

test("permission config preserves key order", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "atomcli.json"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
          permission: {
            "*": "deny",
            edit: "ask",
            write: "ask",
            external_directory: "ask",
            read: "allow",
            todowrite: "allow",
            todoread: "allow",
            "thoughts_*": "allow",
            "reasoning_model_*": "allow",
            "tools_*": "allow",
            "pr_comments_*": "allow",
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(Object.keys(config.permission!)).toEqual([
        "*",
        "edit",
        "write",
        "external_directory",
        "read",
        "todowrite",
        "todoread",
        "thoughts_*",
        "reasoning_model_*",
        "tools_*",
        "pr_comments_*",
      ])
    },
  })
})

test("permission config cannot discard rules through a reserved key", () => {
  expect(ConfigSchema.Permission.parse({ __originalKeys: [], bash: "deny" })).toEqual({ bash: "deny" })
})

// MCP config merging tests

test("project config can override MCP server enabled status", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Simulates a base config (like from remote .well-known) with disabled MCP
      await Bun.write(
        path.join(dir, "atomcli.jsonc"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
          mcp: {
            jira: {
              type: "remote",
              url: "https://jira.example.com/mcp",
              enabled: false,
            },
            wiki: {
              type: "remote",
              url: "https://wiki.example.com/mcp",
              enabled: false,
            },
          },
        }),
      )
      // Project config enables just jira
      await Bun.write(
        path.join(dir, "atomcli.json"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
          mcp: {
            jira: {
              type: "remote",
              url: "https://jira.example.com/mcp",
              enabled: true,
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      // jira should be enabled (overridden by project config)
      expect(config.mcp?.jira).toEqual({
        type: "remote",
        url: "https://jira.example.com/mcp",
        enabled: true,
      })
      // wiki should still be disabled (not overridden)
      expect(config.mcp?.wiki).toEqual({
        type: "remote",
        url: "https://wiki.example.com/mcp",
        enabled: false,
      })
    },
  })
})

test("MCP config deep merges preserving base config properties", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Base config with full MCP definition
      await Bun.write(
        path.join(dir, "atomcli.jsonc"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
          mcp: {
            myserver: {
              type: "remote",
              url: "https://myserver.example.com/mcp",
              enabled: false,
              headers: {
                "X-Custom-Header": "value",
              },
            },
          },
        }),
      )
      // Override just enables it, should preserve other properties
      await Bun.write(
        path.join(dir, "atomcli.json"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
          mcp: {
            myserver: {
              type: "remote",
              url: "https://myserver.example.com/mcp",
              enabled: true,
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.mcp?.myserver).toEqual({
        type: "remote",
        url: "https://myserver.example.com/mcp",
        enabled: true,
        headers: {
          "X-Custom-Header": "value",
        },
      })
    },
  })
})

test("local .atomcli config can override MCP from project config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Project config with disabled MCP
      await Bun.write(
        path.join(dir, "atomcli.json"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
          mcp: {
            docs: {
              type: "remote",
              url: "https://docs.example.com/mcp",
              enabled: false,
            },
          },
        }),
      )
      // Local .atomcli directory config enables it
      const atomcliDir = path.join(dir, ".atomcli")
      await fs.mkdir(atomcliDir, { recursive: true })
      await Bun.write(
        path.join(atomcliDir, "atomcli.json"),
        JSON.stringify({
          $schema: "https://atomcli.ai/config.json",
          mcp: {
            docs: {
              type: "remote",
              url: "https://docs.example.com/mcp",
              enabled: true,
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.mcp?.docs?.enabled).toBe(true)
    },
  })
})

test("project config overrides remote well-known config", async () => {
  const originalFetch = globalThis.fetch
  let fetchedUrl: string | undefined
  const mockFetch = mock((url: string | URL | Request) => {
    const urlStr = url.toString()
    if (urlStr.includes(".well-known/atomcli")) {
      fetchedUrl = urlStr
      return Promise.resolve(
        new Response(
          JSON.stringify({
            config: {
              mcp: {
                jira: {
                  type: "remote",
                  url: "https://jira.example.com/mcp",
                  enabled: false,
                },
              },
            },
          }),
          { status: 200 },
        ),
      )
    }
    return originalFetch(url)
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const originalAuthAll = Auth.all
  Auth.all = mock(() =>
    Promise.resolve({
      "https://example.com": {
        type: "wellknown" as const,
        key: "TEST_TOKEN",
        token: "test-token",
      },
    }),
  )

  try {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        // Project config enables jira (overriding remote default)
        await Bun.write(
          path.join(dir, "atomcli.json"),
          JSON.stringify({
            $schema: "https://atomcli.ai/config.json",
            mcp: {
              jira: {
                type: "remote",
                url: "https://jira.example.com/mcp",
                enabled: true,
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        // Verify fetch was called for wellknown config
        expect(fetchedUrl).toBe("https://example.com/.well-known/atomcli")
        // Project config (enabled: true) should override remote (enabled: false)
        expect(config.mcp?.jira?.enabled).toBe(true)
      },
    })
  } finally {
    globalThis.fetch = originalFetch
    Auth.all = originalAuthAll
  }
})

test("ATOMCLI_CONFIG_CONTENT overrides project and .atomcli directory sources", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "atomcli.json"),
        JSON.stringify({ model: "project/model", username: "project-user", plugin: ["shared@project"] }),
      )
      const atomcliDir = path.join(dir, ".atomcli")
      await fs.mkdir(path.join(atomcliDir, "agent"), { recursive: true })
      await fs.mkdir(path.join(atomcliDir, "command"), { recursive: true })
      await fs.mkdir(path.join(atomcliDir, "plugin"), { recursive: true })
      await fs.mkdir(path.join(atomcliDir, "node_modules"), { recursive: true })
      await Bun.write(path.join(atomcliDir, "atomcli.json"), JSON.stringify({ model: "directory/model" }))
      await Bun.write(path.join(atomcliDir, "agent", "shared.md"), "---\nmodel: markdown/model\n---\nMarkdown prompt")
      await Bun.write(
        path.join(atomcliDir, "command", "deploy.md"),
        "---\ndescription: Markdown command\n---\nMarkdown command",
      )
      await Bun.write(path.join(atomcliDir, "plugin", "shared.js"), "export default {}\n")
    },
  })

  const childHome = path.join(tmp.path, "child-home")
  const childConfig = path.join(tmp.path, "child-config")
  await fs.mkdir(childHome, { recursive: true })
  await fs.mkdir(childConfig, { recursive: true })
  const inline = {
    model: "inline/model",
    username: "inline-user",
    agent: { shared: { model: "inline/agent", prompt: "Inline prompt" } },
    command: { deploy: { template: "Inline command", description: "Inline command" } },
    plugin: ["shared@inline"],
  }
  const script = `
    const { Config } = await import("./src/core/config/config")
    const { Instance } = await import("./src/services/project/instance")
    await Instance.provide({ directory: ${JSON.stringify(tmp.path)}, fn: async () => {
      const config = await Config.get()
      console.log("CONFIG_RESULT=" + JSON.stringify({
        model: config.model,
        username: config.username,
        agent: config.agent?.shared,
        command: config.command?.deploy,
        plugin: config.plugin?.find((item) => Config.getPluginName(item) === "shared"),
      }))
    }})
  `
  const proc = Bun.spawn([process.execPath, "--conditions=browser", "-e", script], {
    cwd: path.resolve(import.meta.dir, "../.."),
    env: {
      ...process.env,
      NODE_ENV: "test",
      ATOMCLI_TEST: "true",
      ATOMCLI_TEST_HOME: childHome,
      XDG_CONFIG_HOME: childConfig,
      XDG_DATA_HOME: path.join(tmp.path, "child-data"),
      XDG_CACHE_HOME: path.join(tmp.path, "child-cache"),
      XDG_STATE_HOME: path.join(tmp.path, "child-state"),
      ATOMCLI_CONFIG_CONTENT: JSON.stringify(inline),
      ATOMCLI_DISABLE_MODELS_FETCH: "true",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    Bun.readableStreamToText(proc.stdout),
    Bun.readableStreamToText(proc.stderr),
  ])
  expect(exitCode, stderr).toBe(0)
  const line = stdout.split("\n").find((item) => item.startsWith("CONFIG_RESULT="))
  expect(line).toBeDefined()
  const result = JSON.parse(line!.slice("CONFIG_RESULT=".length))
  expect(result).toEqual({
    model: "inline/model",
    username: "inline-user",
    agent: expect.objectContaining({ model: "inline/agent", prompt: "Inline prompt" }),
    command: { template: "Inline command", description: "Inline command" },
    plugin: "shared@inline",
  })
}, 15_000)

describe("getPluginName", () => {
  test("extracts name from file:// URL", () => {
    expect(Config.getPluginName("file:///path/to/plugin/foo.js")).toBe("foo")
    expect(Config.getPluginName("file:///path/to/plugin/bar.ts")).toBe("bar")
    expect(Config.getPluginName("file:///some/path/my-plugin.js")).toBe("my-plugin")
  })

  test("extracts name from npm package with version", () => {
    expect(Config.getPluginName("oh-my-atomcli@2.4.3")).toBe("oh-my-atomcli")
    expect(Config.getPluginName("some-plugin@1.0.0")).toBe("some-plugin")
    expect(Config.getPluginName("plugin@latest")).toBe("plugin")
  })

  test("extracts name from scoped npm package", () => {
    expect(Config.getPluginName("@scope/pkg@1.0.0")).toBe("@scope/pkg")
    expect(Config.getPluginName("@atomcli/plugin@2.0.0")).toBe("@atomcli/plugin")
  })

  test("returns full string for package without version", () => {
    expect(Config.getPluginName("some-plugin")).toBe("some-plugin")
    expect(Config.getPluginName("@scope/pkg")).toBe("@scope/pkg")
  })
})

describe("deduplicatePlugins", () => {
  test("removes duplicates keeping higher priority (later entries)", () => {
    const plugins = ["global-plugin@1.0.0", "shared-plugin@1.0.0", "local-plugin@2.0.0", "shared-plugin@2.0.0"]

    const result = Config.deduplicatePlugins(plugins)

    expect(result).toContain("global-plugin@1.0.0")
    expect(result).toContain("local-plugin@2.0.0")
    expect(result).toContain("shared-plugin@2.0.0")
    expect(result).not.toContain("shared-plugin@1.0.0")
    expect(result.length).toBe(3)
  })

  test("prefers local file over npm package with same name", () => {
    const plugins = ["oh-my-atomcli@2.4.3", "file:///project/.atomcli/plugin/oh-my-atomcli.js"]

    const result = Config.deduplicatePlugins(plugins)

    expect(result.length).toBe(1)
    expect(result[0]).toBe("file:///project/.atomcli/plugin/oh-my-atomcli.js")
  })

  test("preserves order of remaining plugins", () => {
    const plugins = ["a-plugin@1.0.0", "b-plugin@1.0.0", "c-plugin@1.0.0"]

    const result = Config.deduplicatePlugins(plugins)

    expect(result).toEqual(["a-plugin@1.0.0", "b-plugin@1.0.0", "c-plugin@1.0.0"])
  })

  test("local plugin directory overrides global atomcli.json plugin", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const projectDir = path.join(dir, "project")
        const atomcliDir = path.join(projectDir, ".atomcli")
        const pluginDir = path.join(atomcliDir, "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        await Bun.write(
          path.join(dir, "atomcli.json"),
          JSON.stringify({
            $schema: "https://atomcli.ai/config.json",
            plugin: ["my-plugin@1.0.0"],
          }),
        )

        await Bun.write(path.join(pluginDir, "my-plugin.js"), "export default {}")
      },
    })

    await Instance.provide({
      directory: path.join(tmp.path, "project"),
      fn: async () => {
        const config = await Config.get()
        const plugins = config.plugin ?? []

        const myPlugins = plugins.filter((p) => Config.getPluginName(p) === "my-plugin")
        expect(myPlugins.length).toBe(1)
        expect(myPlugins[0].startsWith("file://")).toBe(true)
      },
    })
  })
})
