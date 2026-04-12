import path from "path"
import os from "os"
import fs from "fs/promises"
import { existsSync } from "fs"
import { pipe, mergeDeep, unique } from "remeda"

import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { Auth } from "../auth"
import { Flag } from "../flag/flag"
import { Filesystem } from "../util/filesystem"
import { Global } from "../global"
import { lazy } from "../util/lazy"

import { Schemas } from "./schemas"
import { mergeConfigConcatArrays, deduplicatePlugins } from "./utils"
import { loadFile, load } from "./loaders/file"
import { loadCommand } from "./loaders/command"
import { loadAgent, loadMode } from "./loaders/agent"
import { loadPlugin } from "./loaders/plugin"
import { installDependencies } from "./loaders/dependencies"

const log = Log.create({ service: "config" })

export const state = Instance.state(async () => {
    const auth = await Auth.all()

    // Load remote/well-known config first as the base layer (lowest precedence)
    // This allows organizations to provide default configs that users can override
    let result: Schemas.Info = {}
    for (const [key, value] of Object.entries(auth)) {
        if (value.type === "wellknown") {
            process.env[value.key] = value.token
            log.debug("fetching remote config", { url: `${key}/.well-known/atomcli` })
            const response = await fetch(`${key}/.well-known/atomcli`)
            if (!response.ok) {
                throw new Error(`failed to fetch remote config from ${key}: ${response.status}`)
            }
            const wellknown = (await response.json()) as any
            const remoteConfig = wellknown.config ?? {}
            // Add $schema to prevent load() from trying to write back to a non-existent file
            if (!remoteConfig.$schema) remoteConfig.$schema = "https://atomcli.ai/config.json"
            result = mergeConfigConcatArrays(
                result,
                await load(JSON.stringify(remoteConfig), `${key}/.well-known/atomcli`),
            )
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
    for (const file of ["atomcli.jsonc", "atomcli.json"]) {
        const found = await Filesystem.findUp(file, Instance.directory, Instance.worktree)
        for (const resolved of found.toReversed()) {
            result = mergeConfigConcatArrays(result, await loadFile(resolved))
        }
    }

    // Inline config content has highest precedence
    if (Flag.ATOMCLI_CONFIG_CONTENT) {
        result = mergeConfigConcatArrays(result, JSON.parse(Flag.ATOMCLI_CONFIG_CONTENT))
        log.debug("loaded custom config from ATOMCLI_CONFIG_CONTENT")
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

    for (const dir of unique(directories)) {
        if (dir.endsWith(".atomcli") || dir === Flag.ATOMCLI_CONFIG_DIR) {
            for (const file of ["atomcli.jsonc", "atomcli.json"]) {
                log.debug(`loading config from ${path.join(dir, file)}`)
                result = mergeConfigConcatArrays(result, await loadFile(path.join(dir, file)))
                // to satisfy the type checker
                result.agent ??= {}
                result.mode ??= {}
                result.plugin ??= []
            }
        }

        const exists = existsSync(path.join(dir, "node_modules"))
        const installing = installDependencies(dir)
        if (!exists) await installing

        result.command = mergeDeep(result.command ?? {}, await loadCommand(dir))
        result.agent = mergeDeep(result.agent, await loadAgent(dir))
        result.agent = mergeDeep(result.agent, await loadMode(dir))
        result.plugin.push(...(await loadPlugin(dir)))
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
        const perms: Record<string, Schemas.PermissionAction> = {}
        for (const [tool, enabled] of Object.entries(result.tools)) {
            const action: Schemas.PermissionAction = enabled ? "allow" : "deny"
            if (tool === "write" || tool === "edit" || tool === "patch" || tool === "multiedit") {
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

    if (!result.keybinds) result.keybinds = Schemas.Info.shape.keybinds.parse({})

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
})

export const global = lazy(async () => {
    let result: Schemas.Info = pipe(
        {},
        mergeDeep(await loadFile(path.join(Global.Path.config, "config.json"))),
        mergeDeep(await loadFile(path.join(Global.Path.config, "atomcli.json"))),
        mergeDeep(await loadFile(path.join(Global.Path.config, "atomcli.jsonc"))),
    )

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
        .catch(() => { })

    return result
})

export async function get() {
    return state().then((x) => x.config)
}

export async function update(config: Schemas.Info) {
    const filepath = path.join(Instance.directory, "config.json")
    const existing = await loadFile(filepath)
    await Bun.write(filepath, JSON.stringify(mergeDeep(existing, config), null, 2))
    await Instance.dispose()
}

export async function directories() {
    return state().then((x) => x.directories)
}
