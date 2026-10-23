import { Log } from "@/util/util/log"
import path from "path"
import { pathToFileURL } from "url"
import os from "os"
import z from "zod"
import { Filesystem } from "@/util/util/filesystem"
import { mergeDeep, pipe, unique } from "remeda"
import { Global } from "../global"
import fs from "fs/promises"
import { lazy } from "@/util/util/lazy"
import { NamedError } from "@atomcli/util/error"
import { Flag } from "@/interfaces/flag/flag"
import { Auth } from "@/services/auth"
import { type ParseError as JsoncParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser"
import { Instance } from "@/services/project/instance"
import { State } from "@/services/project/state"
import { BunProc } from "@/util/bun"
import { ConfigMarkdown } from "./markdown"
import { existsSync } from "fs"
import { Crypto } from "@/util/util/crypto"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "@/core/bus"
import { Lock } from "@/util/util/lock"
import { ConfigSchema } from "./schema"

export namespace Config {
  const log = Log.create({ service: "config" })
  const PLUGIN_COMPAT_PACKAGE = "@atomcli/plugin@npm:@opencode-ai/plugin@1.14.50"

  // Config update event for notifying listeners when config changes
  export const Event = {
    Updated: BusEvent.define(
      "config.updated",
      z.object({
        config: z.lazy(() => Info),
      }),
    ),
  }

  // Simple LRU cache for loaded config files to avoid redundant disk reads
  const configFileCache = new Map<string, { mtime: number; data: Info }>()
  const MAX_CACHE_SIZE = 50

  // Check if running in test mode - disable cache in tests
  function isTestMode(): boolean {
    return process.env.NODE_ENV === "test" || process.env.ATOMCLI_TEST === "true"
  }

  /**
   * Gets cached config file if it hasn't changed on disk
   * Returns undefined in test mode to disable caching
   */
  async function getCachedConfigFile(filepath: string): Promise<Info | undefined> {
    // Disable cache in test mode
    if (isTestMode()) {
      return undefined
    }

    try {
      const file = Bun.file(filepath)
      const stat = await file.stat()
      const cached = configFileCache.get(filepath)

      if (cached && cached.mtime === stat.mtime.getTime()) {
        log.debug("using cached config", { path: filepath })
        return cached.data
      }

      // Cache miss or file changed - will need to reload
      return undefined
    } catch {
      return undefined
    }
  }

  /**
   * Sets cached config file with current mtime
   * No-op in test mode
   */
  async function setCachedConfigFile(filepath: string, data: Info): Promise<void> {
    // Disable cache in test mode
    if (isTestMode()) {
      return
    }

    try {
      const file = Bun.file(filepath)
      const stat = await file.stat()

      // Implement LRU eviction
      if (configFileCache.size >= MAX_CACHE_SIZE && !configFileCache.has(filepath)) {
        const firstKey = configFileCache.keys().next().value
        if (firstKey !== undefined) {
          configFileCache.delete(firstKey)
        }
      }

      configFileCache.set(filepath, { mtime: stat.mtime.getTime(), data })
    } catch {
      // Ignore cache errors
    }
  }

  /**
   * Clears the config file cache - useful for testing or when config is updated
   */
  export async function clearCache(): Promise<void> {
    configFileCache.clear()
    global.reset()
    // Clear the instance state to force fresh config loading (only if instance exists)
    try {
      const dir = Instance.directory
      if (dir) {
        await State.dispose(dir)
      }
    } catch {
      // Ignore if no instance context is available
    }
  }

  // Custom merge function that concatenates array fields instead of replacing them
  function mergeConfigConcatArrays(target: Info, source: Info): Info {
    // Fast path: if target is empty, just return source (avoid unnecessary merge)
    if (Object.keys(target).length === 0) {
      return { ...source }
    }

    const merged: any = mergeDeep(target, source)
    if (target.plugin && source.plugin) {
      // Use faster Set-based deduplication for plugins
      merged.plugin = [...new Set([...target.plugin, ...source.plugin])]
    }
    if (target.instructions && source.instructions) {
      merged.instructions = [...new Set([...target.instructions, ...source.instructions])]
    }
    return merged
  }

  // Config loading implementation - extracted for reuse in test mode
  async function loadConfigState(): Promise<{ config: Info; directories: string[] }> {
    const auth = await Auth.all()

    // Load remote/well-known config first as the base layer (lowest precedence)
    // This allows organizations to provide default configs that users can override
    let result: Info = {}
    for (const [key, value] of Object.entries(auth)) {
      if (value.type === "wellknown") {
        process.env[value.key] = value.token
        log.debug("fetching remote config", { url: `${key}/.well-known/atomcli` })
        const response = await fetch(`${key}/.well-known/atomcli`)
        if (!response.ok) {
          throw new Error(`failed to fetch remote config from ${key}: ${response.status}`)
        }
        const body = await response.text()
        // Verify config integrity via HMAC-SHA256 signature
        const signature = response.headers.get("X-Config-Signature")
        if (signature) {
          const valid = Crypto.verifyHMAC(body, signature, value.token)
          if (!valid) {
            log.error("Remote config signature verification failed", { url: key })
            throw new Error(`Remote config signature invalid for ${key}. Config rejected.`)
          }
          log.debug("remote config signature verified", { url: key })
        } else {
          log.warn("Remote config has no signature - loading without verification", { url: key })
        }
        const wellknown = JSON.parse(body) as any
        const remoteConfig = wellknown.config ?? {}
        // Add $schema to prevent load() from trying to write back to a non-existent file
        if (!remoteConfig.$schema) remoteConfig.$schema = "https://atomcli.ai/config.json"
        result = mergeConfigConcatArrays(result, await load(JSON.stringify(remoteConfig), `${key}/.well-known/atomcli`))
        log.debug("loaded remote config from well-known", { url: key })
      }
    }

    // Global user config overrides remote config
    result = mergeConfigConcatArrays(result, await global())

    // Custom config path overrides global
    if (Flag.ATOMCLI_CONFIG) {
      result = mergeConfigConcatArrays(result, await loadFile(Flag.ATOMCLI_CONFIG))
      log.debug("loaded custom config", { path: Flag.ATOMCLI_CONFIG })
    }

    // Project config has highest precedence (overrides global and remote)
    for (const file of ["atomcli.jsonc", "atomcli.json", "mcp.json"]) {
      const found = await Filesystem.findUp(file, Instance.directory, Instance.worktree)
      for (const resolved of found.toReversed()) {
        const config = await loadFile(resolved)
        if (file === "mcp.json") {
          // If loading mcp.json, wrap it in an mcp object if it isn't already
          if (!config.mcp && Object.keys(config).every((k) => k !== "mcp" && k !== "provider")) {
            result = mergeConfigConcatArrays(result, { mcp: config as any })
          } else {
            result = mergeConfigConcatArrays(result, config)
          }
        } else {
          result = mergeConfigConcatArrays(result, config)
        }
      }
    }

    result.agent = result.agent || {}
    result.mode = result.mode || {}
    result.plugin = result.plugin || []

    const directories = [
      Global.Path.config,
      ...(await Array.fromAsync(
        Filesystem.up({
          targets: [".atomcli"],
          start: Instance.directory,
          stop: Instance.worktree,
        }),
      )),
      ...(await Array.fromAsync(
        Filesystem.up({
          targets: [".atomcli"],
          start: Global.Path.home,
          stop: Global.Path.home,
        }),
      )),
    ]

    if (Flag.ATOMCLI_CONFIG_DIR) {
      directories.push(Flag.ATOMCLI_CONFIG_DIR)
      log.debug("loading config from ATOMCLI_CONFIG_DIR", { path: Flag.ATOMCLI_CONFIG_DIR })
    }

    // Scan .atomcli/skill/ directories
    for (const dir of unique(directories)) {
      // Skip loading config files from Global.Path.config since it was already loaded via global()
      // This prevents global config from overriding project config (project should have higher precedence)
      // We still process Global.Path.config for loading skills/agents/plugins below
      const isGlobalConfigDir = dir === Global.Path.config
      if ((dir.endsWith(".atomcli") || dir === Flag.ATOMCLI_CONFIG_DIR) && !isGlobalConfigDir) {
        for (const file of ["atomcli.jsonc", "atomcli.json", "mcp.json"]) {
          const filePath = path.join(dir, file)
          const fileExists = existsSync(filePath)
          if (!fileExists) continue

          log.debug(`loading config from ${filePath}`)
          const config = await loadFile(filePath)

          if (file === "mcp.json") {
            // If loading mcp.json, assume top-level keys are mcp servers if not structured otherwise
            if (!config.mcp && Object.keys(config).every((k) => k !== "mcp" && k !== "provider")) {
              result = mergeConfigConcatArrays(result, { mcp: config as any })
            } else {
              result = mergeConfigConcatArrays(result, config)
            }
          } else {
            result = mergeConfigConcatArrays(result, config)
          }

          // to satisfy the type checker
          result.agent ??= {}
          result.mode ??= {}
          result.plugin ??= []
        }
      }

      const dependenciesReady =
        existsSync(path.join(dir, "node_modules")) &&
        existsSync(path.join(dir, "node_modules", "@atomcli", "plugin", "package.json"))
      if (!dependenciesReady) await installDependencies(dir)

      result.command = mergeDeep(result.command ?? {}, await loadCommand(dir))
      result.agent = mergeDeep(result.agent, await loadAgent(dir))
      result.agent = mergeDeep(result.agent, await loadMode(dir))
      result.plugin.push(...(await loadPlugin(dir)))
    }

    // Inline content is the final config layer. Apply it after all project and
    // directory-based JSON/Markdown/plugin discovery so the documented
    // ATOMCLI_CONFIG_CONTENT precedence cannot be reversed by a later scan.
    if (Flag.ATOMCLI_CONFIG_CONTENT) {
      const inline = Info.parse(JSON.parse(Flag.ATOMCLI_CONFIG_CONTENT))
      result = mergeConfigConcatArrays(result, inline)
      log.debug("loaded custom config from ATOMCLI_CONFIG_CONTENT")
    }

    // Remote credentials are a global-user concern. Project, directory,
    // well-known, and inline config layers may enable the tool but must not add
    // or override connection profiles.
    const globalRemoteHosts = (await global()).remote?.hosts ?? {}
    const mergedRemoteHosts = result.remote?.hosts ?? {}
    const ignoredRemoteHosts = Object.keys(mergedRemoteHosts).filter(
      (name) => JSON.stringify(mergedRemoteHosts[name]) !== JSON.stringify(globalRemoteHosts[name]),
    )
    if (ignoredRemoteHosts.length > 0) {
      log.warn("ignoring non-global remote host profiles", { profiles: ignoredRemoteHosts })
    }
    if (result.remote || Object.keys(globalRemoteHosts).length > 0) {
      result.remote = { ...result.remote, hosts: globalRemoteHosts }
    }

    // Migrate deprecated mode field to agent field
    for (const [name, mode] of Object.entries(result.mode)) {
      result.agent = mergeDeep(result.agent ?? {}, {
        [name]: {
          ...mode,
          mode: "primary" as const,
        },
      })
    }

    if (Flag.ATOMCLI_PERMISSION) {
      result.permission = mergeDeep(result.permission ?? {}, JSON.parse(Flag.ATOMCLI_PERMISSION))
    }

    // Backwards compatibility: legacy top-level `tools` config
    if (result.tools) {
      const perms: Record<string, Config.PermissionAction> = {}
      for (const [tool, enabled] of Object.entries(result.tools)) {
        const action: Config.PermissionAction = enabled ? "allow" : "deny"
        if (tool === "write" || tool === "edit") {
          perms.edit = action
          continue
        }
        perms[tool] = action
      }
      result.permission = mergeDeep(perms, result.permission ?? {})
    }

    if (!result.username) result.username = os.userInfo().username

    // Handle migration from autoshare to share field
    if (result.autoshare === true && !result.share) {
      result.share = "auto"
    }

    if (!result.keybinds) result.keybinds = Info.shape.keybinds.parse({})

    // Apply flag overrides for compaction settings
    if (Flag.ATOMCLI_DISABLE_AUTOCOMPACT) {
      result.compaction = { ...result.compaction, auto: false }
    }
    if (Flag.ATOMCLI_DISABLE_PRUNE) {
      result.compaction = { ...result.compaction, prune: false }
    }

    result.plugin = deduplicatePlugins(result.plugin ?? [])

    return {
      config: result,
      directories,
    }
  }

  // In test mode, don't use Instance.state caching - always load fresh
  // In normal mode, use Instance.state for caching
  export const state = isTestMode() ? loadConfigState : Instance.state(loadConfigState)

  export async function installDependencies(dir: string) {
    const resolvedDir = path.resolve(dir)
    using _ = await Lock.write(`config-install:${resolvedDir}`)

    // Another concurrent config load may have completed installation while
    // this caller waited for the lock.
    const compatPackage = path.join(resolvedDir, "node_modules", "@atomcli", "plugin", "package.json")
    if (existsSync(compatPackage)) return

    const pkg = path.join(resolvedDir, "package.json")

    if (!(await Bun.file(pkg).exists())) {
      await Bun.write(pkg, "{}")
    }

    const gitignore = path.join(resolvedDir, ".gitignore")
    const hasGitIgnore = await Bun.file(gitignore).exists()
    if (!hasGitIgnore) await Bun.write(gitignore, ["node_modules", "package.json", "bun.lock", ".gitignore"].join("\n"))

    // @atomcli/plugin is not published independently. Install the compatible
    // OpenCode plugin SDK under AtomCLI's package name so local TypeScript
    // plugins resolve their existing imports without a registry 404.
    await BunProc.run(["add", PLUGIN_COMPAT_PACKAGE, "--exact"], { cwd: resolvedDir }).catch((error) => {
      log.warn("failed to install plugin SDK compatibility package", { dir: resolvedDir, error })
    })

    // Install any additional dependencies defined in the package.json
    // This allows local plugins and custom tools to use external packages
    await BunProc.run(["install"], { cwd: resolvedDir }).catch(() => {})
  }

  const COMMAND_GLOB = new Bun.Glob("{command,commands}/**/*.md")
  async function loadCommand(dir: string) {
    const result: Record<string, Command> = {}
    for await (const item of COMMAND_GLOB.scan({
      absolute: true,
      followSymlinks: true,
      dot: true,
      cwd: dir,
    })) {
      const md = await ConfigMarkdown.parse(item)
      if (!md.data) continue

      const name = (() => {
        const normalizedItem = item.replaceAll("\\", "/")
        const patterns = ["/.atomcli/command/", "/command/"]
        const pattern = patterns.find((p) => normalizedItem.includes(p))

        if (pattern) {
          const index = normalizedItem.indexOf(pattern)
          return normalizedItem.slice(index + pattern.length, -3)
        }
        return path.basename(item, ".md")
      })()

      const config = {
        name,
        ...md.data,
        template: md.content.trim(),
      }
      const parsed = Command.safeParse(config)
      if (parsed.success) {
        result[config.name] = parsed.data
        continue
      }
      throw new InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
    }
    return result
  }

  const AGENT_GLOB = new Bun.Glob("{agent,agents}/**/*.md")
  async function loadAgent(dir: string) {
    const result: Record<string, Agent> = {}

    for await (const item of AGENT_GLOB.scan({
      absolute: true,
      followSymlinks: true,
      dot: true,
      cwd: dir,
    })) {
      const md = await ConfigMarkdown.parse(item)
      if (!md.data) continue

      // Extract relative path from agent folder for nested agents
      let agentName = path.basename(item, ".md")
      const normalizedItem = item.replaceAll("\\", "/")
      const agentFolderPath = normalizedItem.includes("/.atomcli/agent/")
        ? normalizedItem.split("/.atomcli/agent/")[1]
        : normalizedItem.includes("/agent/")
          ? normalizedItem.split("/agent/")[1]
          : agentName + ".md"

      // If agent is in a subfolder, include folder path in name
      if (agentFolderPath.includes("/")) {
        const relativePath = agentFolderPath.replace(".md", "")
        const pathParts = relativePath.split("/")
        agentName = pathParts.slice(0, -1).join("/") + "/" + pathParts[pathParts.length - 1]
      }

      const config = {
        name: agentName,
        ...md.data,
        prompt: md.content.trim(),
      }
      const parsed = Agent.safeParse(config)
      if (parsed.success) {
        result[config.name] = parsed.data
        continue
      }
      throw new InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
    }
    return result
  }

  const MODE_GLOB = new Bun.Glob("{mode,modes}/*.md")
  async function loadMode(dir: string) {
    const result: Record<string, Agent> = {}
    for await (const item of MODE_GLOB.scan({
      absolute: true,
      followSymlinks: true,
      dot: true,
      cwd: dir,
    })) {
      const md = await ConfigMarkdown.parse(item)
      if (!md.data) continue

      const config = {
        name: path.basename(item, ".md"),
        ...md.data,
        prompt: md.content.trim(),
      }
      const parsed = Agent.safeParse(config)
      if (parsed.success) {
        result[config.name] = {
          ...parsed.data,
          mode: "primary" as const,
        }
        continue
      }
    }
    return result
  }

  const PLUGIN_GLOB = new Bun.Glob("{plugin,plugins}/*.{ts,js}")
  async function loadPlugin(dir: string) {
    const plugins: string[] = []

    for await (const item of PLUGIN_GLOB.scan({
      absolute: true,
      followSymlinks: true,
      dot: true,
      cwd: dir,
    })) {
      plugins.push(pathToFileURL(item).href)
    }
    return plugins
  }

  /**
   * Extracts a canonical plugin name from a plugin specifier.
   * - For file:// URLs: extracts filename without extension
   * - For npm packages: extracts package name without version
   *
   * @example
   * getPluginName("file:///path/to/plugin/foo.js") // "foo"
   * getPluginName("oh-my-atomcli@2.4.3") // "oh-my-atomcli"
   * getPluginName("@scope/pkg@1.0.0") // "@scope/pkg"
   */
  export function getPluginName(plugin: string): string {
    if (plugin.startsWith("file://")) {
      return path.parse(new URL(plugin).pathname).name
    }
    const lastAt = plugin.lastIndexOf("@")
    if (lastAt > 0) {
      return plugin.substring(0, lastAt)
    }
    return plugin
  }

  /**
   * Deduplicates plugins by name, with later entries (higher priority) winning.
   * Priority order (highest to lowest):
   * 1. Local plugin/ directory
   * 2. Local atomcli.json
   * 3. Global plugin/ directory
   * 4. Global atomcli.json
   *
   * Since plugins are added in low-to-high priority order,
   * we reverse, deduplicate (keeping first occurrence), then restore order.
   */
  export function deduplicatePlugins(plugins: string[]): string[] {
    // seenNames: canonical plugin names for duplicate detection
    // e.g., "oh-my-atomcli", "@scope/pkg"
    const seenNames = new Set<string>()

    // uniqueSpecifiers: full plugin specifiers to return
    // e.g., "oh-my-atomcli@2.4.3", "file:///path/to/plugin.js"
    const uniqueSpecifiers: string[] = []

    for (const specifier of plugins.toReversed()) {
      const name = getPluginName(specifier)
      if (!seenNames.has(name)) {
        seenNames.add(name)
        uniqueSpecifiers.push(specifier)
      }
    }

    return uniqueSpecifiers.toReversed()
  }

  export const McpLocal = ConfigSchema.McpLocal
  export const McpOAuth = ConfigSchema.McpOAuth
  export const McpRemote = ConfigSchema.McpRemote
  export const Mcp = ConfigSchema.Mcp
  export const PermissionAction = ConfigSchema.PermissionAction
  export const PermissionObject = ConfigSchema.PermissionObject
  export const PermissionRule = ConfigSchema.PermissionRule
  export const Permission = ConfigSchema.Permission
  export const Command = ConfigSchema.Command
  export const Agent = ConfigSchema.Agent
  export const Keybinds = ConfigSchema.Keybinds
  export const TUI = ConfigSchema.TUI
  export const Server = ConfigSchema.Server
  export const Layout = ConfigSchema.Layout
  export const Provider = ConfigSchema.Provider
  export const RemoteHost = ConfigSchema.RemoteHost
  export const Info = ConfigSchema.Info
  export type McpOAuth = ConfigSchema.McpOAuth
  export type Mcp = ConfigSchema.Mcp
  export type PermissionAction = ConfigSchema.PermissionAction
  export type PermissionObject = ConfigSchema.PermissionObject
  export type PermissionRule = ConfigSchema.PermissionRule
  export type Permission = ConfigSchema.Permission
  export type Command = ConfigSchema.Command
  export type Agent = ConfigSchema.Agent
  export type Layout = ConfigSchema.Layout
  export type Provider = ConfigSchema.Provider
  export type RemoteHost = ConfigSchema.RemoteHost
  export type Info = ConfigSchema.Info

  export const global = lazy(async () => {
    const configJson = await loadFile(path.join(Global.Path.config, "config.json"))
    const atomcliJson = await loadFile(path.join(Global.Path.config, "atomcli.json"))
    const atomcliJsonc = await loadFile(path.join(Global.Path.config, "atomcli.jsonc"))
    const mcpJson = await loadMcpFile(path.join(Global.Path.config, "mcp.json"))

    let mcpConfig: Info = {}
    if (Object.keys(mcpJson).length > 0) {
      // If mcp.json has a top-level 'mcp' key, use it directly; otherwise wrap the content
      if (mcpJson.mcp) {
        mcpConfig = { mcp: mcpJson.mcp }
      } else {
        mcpConfig = { mcp: mcpJson }
      }
    }

    let result: Info = pipe(
      {} as any,
      mergeDeep(configJson as any),
      mergeDeep(atomcliJson as any),
      mergeDeep(atomcliJsonc as any),
      mergeDeep(mcpConfig as any),
    ) as Info

    await import(path.join(Global.Path.config, "config"), {
      with: {
        type: "toml",
      },
    })
      .then(async (mod) => {
        const { provider, model, ...rest } = mod.default
        if (provider && model) result.model = `${provider}/${model}`
        result["$schema"] = "https://atomcli.ai/config.json"
        result = mergeDeep(result, rest)
        await Bun.write(path.join(Global.Path.config, "config.json"), JSON.stringify(result, null, 2))
        await fs.unlink(path.join(Global.Path.config, "config"))
      })
      .catch(() => {})

    return result
  })

  async function loadFile(filepath: string): Promise<Info> {
    // Check cache first
    const cached = await getCachedConfigFile(filepath)
    if (cached !== undefined) {
      return cached
    }

    log.info("loading", { path: filepath })
    let text = await Bun.file(filepath)
      .text()
      .catch((err) => {
        if (err.code === "ENOENT") return
        throw new JsonError({ path: filepath }, { cause: err })
      })
    if (!text) return {}

    const result = await load(text, filepath)

    // Cache the result
    await setCachedConfigFile(filepath, result)

    return result
  }

  // Load mcp.json without strict schema validation
  async function loadMcpFile(filepath: string): Promise<Record<string, any>> {
    log.info("loading mcp config", { path: filepath })
    let text = await Bun.file(filepath)
      .text()
      .catch((err) => {
        if (err.code === "ENOENT") return
        throw new JsonError({ path: filepath }, { cause: err })
      })
    if (!text) return {}

    const errors: JsoncParseError[] = []
    const data = parseJsonc(text, errors, { allowTrailingComma: true })
    if (errors.length) {
      log.warn("failed to parse mcp.json", { path: filepath })
      return {}
    }
    return data as Record<string, any>
  }

  async function load(text: string, configFilepath: string) {
    text = text.replace(/\{env:([^}]+)\}/g, (_, varName) => {
      return process.env[varName] || ""
    })

    const fileMatches = text.match(/\{file:[^}]+\}/g)
    if (fileMatches) {
      const configDir = path.dirname(configFilepath)
      const lines = text.split("\n")

      for (const match of fileMatches) {
        const lineIndex = lines.findIndex((line) => line.includes(match))
        if (lineIndex !== -1 && lines[lineIndex].trim().startsWith("//")) {
          continue // Skip if line is commented
        }
        let filePath = match.replace(/^\{file:/, "").replace(/\}$/, "")
        if (filePath.startsWith("~/")) {
          filePath = path.join(os.homedir(), filePath.slice(2))
        }
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(configDir, filePath)
        const fileContent = (
          await Bun.file(resolvedPath)
            .text()
            .catch((error) => {
              const errMsg = `bad file reference: "${match}"`
              if (error.code === "ENOENT") {
                throw new InvalidError(
                  {
                    path: configFilepath,
                    message: errMsg + ` ${resolvedPath} does not exist`,
                  },
                  { cause: error },
                )
              }
              throw new InvalidError({ path: configFilepath, message: errMsg }, { cause: error })
            })
        ).trim()
        // escape newlines/quotes, strip outer quotes
        text = text.replace(match, JSON.stringify(fileContent).slice(1, -1))
      }
    }

    const errors: JsoncParseError[] = []
    const data = parseJsonc(text, errors, { allowTrailingComma: true })
    if (errors.length) {
      const lines = text.split("\n")
      const errorDetails = errors
        .map((e) => {
          const beforeOffset = text.substring(0, e.offset).split("\n")
          const line = beforeOffset.length
          const column = beforeOffset[beforeOffset.length - 1].length + 1
          const problemLine = lines[line - 1]

          const error = `${printParseErrorCode(e.error)} at line ${line}, column ${column}`
          if (!problemLine) return error

          return `${error}\n   Line ${line}: ${problemLine}\n${"".padStart(column + 9)}^`
        })
        .join("\n")

      throw new JsonError({
        path: configFilepath,
        message: `\n--- JSONC Input ---\n${text}\n--- Errors ---\n${errorDetails}\n--- End ---`,
      })
    }

    const parsed = Info.safeParse(data)
    if (parsed.success) {
      if (!parsed.data.$schema) {
        parsed.data.$schema = "https://atomcli.ai/config.json"
        await Bun.write(configFilepath, JSON.stringify(parsed.data, null, 2))
      }
      const data = parsed.data
      if (data.plugin) {
        for (let i = 0; i < data.plugin.length; i++) {
          const plugin = data.plugin[i]
          try {
            data.plugin[i] = import.meta.resolve!(plugin, configFilepath)
          } catch (err) {}
        }
      }
      return data
    }

    throw new InvalidError({
      path: configFilepath,
      issues: parsed.error.issues,
    })
  }
  export const JsonError = NamedError.create(
    "ConfigJsonError",
    z.object({
      path: z.string(),
      message: z.string().optional(),
    }),
  )

  export const ConfigDirectoryTypoError = NamedError.create(
    "ConfigDirectoryTypoError",
    z.object({
      path: z.string(),
      dir: z.string(),
      suggestion: z.string(),
    }),
  )

  export const InvalidError = NamedError.create(
    "ConfigInvalidError",
    z.object({
      path: z.string(),
      issues: z.custom<z.core.$ZodIssue[]>().optional(),
      message: z.string().optional(),
    }),
  )

  export async function get() {
    return state().then((x) => x.config)
  }

  /**
   * SSH credentials deliberately bypass the merged project config. A cloned
   * repository may enable the tool, but it cannot add or override a host.
   */
  export async function remoteHosts() {
    return (await global()).remote?.hosts ?? {}
  }

  export async function update(config: Partial<Info>) {
    // Find all config files in .atomcli directories (same logic as reading)
    const configFiles = ["atomcli.jsonc", "atomcli.json", "config.json"]
    let filepath: string | undefined

    // Collect all .atomcli directories (same order as reading)
    const directories = [
      ...(await Array.fromAsync(
        Filesystem.up({
          targets: [".atomcli"],
          start: Instance.directory,
          stop: Instance.worktree,
        }),
      )),
    ]

    // Find the LAST (highest priority) .atomcli directory with a config file
    // This matches the load order where later files override earlier ones
    for (const dir of directories.toReversed()) {
      for (const file of configFiles) {
        const configPath = path.join(dir, file)
        if (existsSync(configPath)) {
          filepath = configPath
          break
        }
      }
      if (filepath) break
    }

    // Fallback: check Instance.directory/.atomcli
    if (!filepath) {
      for (const file of configFiles) {
        const atomcliPath = path.join(Instance.directory, ".atomcli", file)
        if (existsSync(atomcliPath)) {
          filepath = atomcliPath
          break
        }
      }
    }

    // If no existing config, create new one in .atomcli directory
    if (!filepath) {
      const atomcliDir = path.join(Instance.directory, ".atomcli")
      await fs.mkdir(atomcliDir, { recursive: true }).catch(() => {})
      filepath = path.join(atomcliDir, "atomcli.json")
    }

    log.info("updating config", { filepath, config })
    const existing = existsSync(filepath) ? await loadFile(filepath) : {}
    const merged: any = mergeDeep(existing, config)
    await Bun.write(filepath, JSON.stringify(merged, null, 2))
    log.info("config updated", { filepath, experimental: merged.experimental })

    // Clear cache to ensure fresh config is loaded next time
    configFileCache.clear()

    await Instance.dispose()

    // Publish config updated event
    const updatedConfig = await get()
    log.info("config event published", { smart_model_routing: updatedConfig.experimental?.smart_model_routing })
    Bus.publish(Event.Updated, { config: updatedConfig })
  }

  export async function directories() {
    return state().then((x) => x.directories)
  }
}
