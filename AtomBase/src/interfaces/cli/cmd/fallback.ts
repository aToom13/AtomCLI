import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Config } from "@/core/config/config"
import { Provider } from "@/integrations/provider/provider"
import { ModelFallback } from "@/integrations/provider/fallback"
import { Global } from "@/core/global"
import { mergeDeep } from "remeda"
import path from "path"
import type { Argv } from "yargs"

/**
 * Load global config (works outside of project directory)
 */
async function getGlobalConfig(): Promise<Config.Info> {
    return Config.global()
}

/**
 * Save to global config file
 */
async function saveGlobalConfig(config: Config.Info): Promise<void> {
    const configPath = path.join(Global.Path.config, "atomcli.json")
    const existing = await Bun.file(configPath).json().catch(() => ({}))
    const merged = mergeDeep(existing, config)
    await Bun.write(configPath, JSON.stringify(merged, null, 2))
}

/**
 * Parse model ID string (provider/model format)
 */
function parseModelID(modelID: string): { providerID: string; modelID: string } | null {
    const parts = modelID.split("/")
    if (parts.length !== 2) return null
    return { providerID: parts[0], modelID: parts[1] }
}

export const FallbackCommand = cmd({
    command: "fallback",
    describe: "configure fallback models for automatic model switching on errors",
    builder: (yargs: Argv) => {
        return yargs
            .option("secondary", {
                type: "string",
                describe: "Set secondary fallback model (e.g., atomcli/minimax-m2.5-free)",
            })
            .option("tertiary", {
                type: "string",
                describe: "Set tertiary fallback model (e.g., atomcli/gpt-5-nano)",
            })
            .option("enable", {
                type: "boolean",
                describe: "Enable or disable fallback mechanism",
            })
            .option("list", {
                type: "boolean",
                describe: "List current fallback configuration",
            })
            .option("reset", {
                type: "boolean",
                describe: "Reset to default fallback models",
            })
    },
    handler: async (args) => {
        const config = await getGlobalConfig()

        // List current configuration
        if (args.list) {
            UI.println("Current Fallback Configuration:")
            UI.println(`  Enabled: ${config.fallback?.enabled ?? true}`)
            UI.println(`  Secondary: ${config.fallback?.secondary ?? "atomcli/minimax-m2.5-free (default)"}`)
            UI.println(`  Tertiary: ${config.fallback?.tertiary ?? "atomcli/gpt-5-nano (default)"}`)
            UI.println("")
            UI.println("Default fallback models:")
            for (const model of ModelFallback.DEFAULT_FALLBACK_MODELS) {
                UI.println(`  - ${model}`)
            }
            return
        }

        // Reset to defaults
        if (args.reset) {
            await saveGlobalConfig({
                fallback: {
                    enabled: true,
                    secondary: ModelFallback.DEFAULT_FALLBACK_MODELS[0],
                    tertiary: ModelFallback.DEFAULT_FALLBACK_MODELS[1],
                },
            })
            UI.println("✓ Fallback configuration reset to defaults:")
            UI.println(`  Secondary: ${ModelFallback.DEFAULT_FALLBACK_MODELS[0]}`)
            UI.println(`  Tertiary: ${ModelFallback.DEFAULT_FALLBACK_MODELS[1]}`)
            return
        }

        // Interactive mode (no specific options provided)
        if (!args.secondary && !args.tertiary && args.enable === undefined) {
            prompts.intro("Fallback Model Configuration")

            const enabled = await prompts.confirm({
                message: "Enable fallback mechanism?",
                initialValue: config.fallback?.enabled ?? true,
            })

            if (enabled === Symbol.for("clack:cancel")) {
                prompts.cancel("Operation cancelled")
                return
            }

            // Use text input instead of select (to avoid Instance context requirement)
            const secondary = await prompts.text({
                message: "Enter secondary fallback model (format: provider/model)",
                placeholder: config.fallback?.secondary ?? ModelFallback.DEFAULT_FALLBACK_MODELS[0],
                validate: (value) => {
                    if (!value) return undefined // Allow empty to use default
                    const parsed = parseModelID(value)
                    if (!parsed) return "Invalid format. Use: provider/model (e.g., atomcli/minimax-m2.5-free)"
                    return undefined
                },
            })

            if (secondary === Symbol.for("clack:cancel")) {
                prompts.cancel("Operation cancelled")
                return
            }

            const tertiary = await prompts.text({
                message: "Enter tertiary fallback model (format: provider/model)",
                placeholder: config.fallback?.tertiary ?? ModelFallback.DEFAULT_FALLBACK_MODELS[1],
                validate: (value) => {
                    if (!value) return undefined // Allow empty to use default
                    const parsed = parseModelID(value)
                    if (!parsed) return "Invalid format. Use: provider/model (e.g., atomcli/gpt-5-nano)"
                    return undefined
                },
            })

            if (tertiary === Symbol.for("clack:cancel")) {
                prompts.cancel("Operation cancelled")
                return
            }

            const fallbackConfig: { enabled: boolean; secondary?: string; tertiary?: string } = {
                enabled: enabled as boolean,
            }

            if (secondary && typeof secondary === "string") {
                fallbackConfig.secondary = secondary
            }

            if (tertiary && typeof tertiary === "string") {
                fallbackConfig.tertiary = tertiary
            }

            await saveGlobalConfig({
                fallback: fallbackConfig,
            })

            prompts.outro("✓ Fallback configuration saved!")
            return
        }

        // Command line mode (specific options provided)
        const updates: { enabled?: boolean; secondary?: string; tertiary?: string } = {}

        if (args.enable !== undefined) {
            updates.enabled = args.enable
        }

        if (args.secondary) {
            const parsed = parseModelID(args.secondary)
            if (!parsed) {
                UI.println(`Error: Invalid model format "${args.secondary}". Use: provider/model`)
                return
            }
            updates.secondary = args.secondary
        }

        if (args.tertiary) {
            const parsed = parseModelID(args.tertiary)
            if (!parsed) {
                UI.println(`Error: Invalid model format "${args.tertiary}". Use: provider/model`)
                return
            }
            updates.tertiary = args.tertiary
        }

        await saveGlobalConfig({
            fallback: {
                enabled: config.fallback?.enabled ?? true,
                secondary: config.fallback?.secondary,
                tertiary: config.fallback?.tertiary,
                ...updates,
            },
        })

        UI.println("✓ Fallback configuration updated!")

        // Show current config
        const newConfig = await getGlobalConfig()
        UI.println(`  Enabled: ${newConfig.fallback?.enabled ?? true}`)
        if (updates.secondary || newConfig.fallback?.secondary) {
            UI.println(`  Secondary: ${newConfig.fallback?.secondary ?? "not set"}`)
        }
        if (updates.tertiary || newConfig.fallback?.tertiary) {
            UI.println(`  Tertiary: ${newConfig.fallback?.tertiary ?? "not set"}`)
        }
    },
})
