import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Config } from "@/config/config"
import { Global } from "@/global"
import path from "path"
import { mergeDeep } from "remeda"
import fs from "fs/promises"

async function loadFile(filepath: string): Promise<Record<string, any>> {
    try {
        const file = Bun.file(filepath)
        if (!(await file.exists())) return {}
        const content = await file.text()
        // Handle JSONC (JSON with comments)
        const { parse } = await import("jsonc-parser")
        const errors: any[] = []
        const result = parse(content, errors, { allowTrailingComma: true })
        if (errors.length > 0) {
            console.error(`Parse errors in ${filepath}:`, errors)
            return {}
        }
        return result || {}
    } catch {
        return {}
    }
}

export const AutoupdateCommand = cmd({
    command: "autoupdate <action>",
    describe: "manage automatic update settings",
    builder: (yargs: Argv) =>
        yargs
            .positional("action", {
                describe: "action to perform",
                type: "string",
                choices: ["on", "off", "status"],
                demandOption: true,
            })
            .option("channel", {
                alias: "c",
                describe: "release channel for updates",
                type: "string",
                choices: ["stable", "beta", "alfa"],
            }),

    handler: async (argv) => {
        const action = argv.action as string
        const channel = argv.channel as string | undefined

        // Load global config
        const configPath = path.join(Global.Path.config, "config.json")
        const existingConfig = await loadFile(configPath)

        switch (action) {
            case "on": {
                const selectedChannel = channel || "stable"
                const newConfig = {
                    ...existingConfig,
                    autoupdate: true,
                    channel: selectedChannel,
                }

                // Ensure config directory exists
                await fs.mkdir(Global.Path.config, { recursive: true })
                await Bun.write(configPath, JSON.stringify(newConfig, null, 2))

                console.log(`✅ Otomatik güncelleme açıldı`)
                console.log(`   Channel: ${selectedChannel}`)
                break
            }
            case "off": {
                const newConfig = {
                    ...existingConfig,
                    autoupdate: false,
                }

                await fs.mkdir(Global.Path.config, { recursive: true })
                await Bun.write(configPath, JSON.stringify(newConfig, null, 2))

                console.log("❌ Otomatik güncelleme kapatıldı")
                break
            }
            case "status": {
                const autoupdate = existingConfig.autoupdate
                const configChannel = existingConfig.channel || "stable"

                if (autoupdate === true) {
                    console.log("Otomatik güncelleme: ✅ AÇIK")
                } else if (autoupdate === "notify") {
                    console.log("Otomatik güncelleme: 🔔 NOTIFY (sadece bildirim)")
                } else {
                    console.log("Otomatik güncelleme: ❌ KAPALI")
                }
                console.log(`Channel: ${configChannel}`)
                break
            }
            default: {
                console.error(`Bilinmeyen action: ${action}`)
                console.error("Kullanım: atomcli autoupdate [on|off|status]")
                process.exit(1)
            }
        }
    },
})
