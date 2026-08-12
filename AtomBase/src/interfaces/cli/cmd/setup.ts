import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Browser, detectLinuxDistro, resolveBundledPlaywrightVersion } from "@/integrations/browser"
import { $ } from "bun"
import { Log } from "@/util/util/log"

const log = Log.create({ service: "setup" })

export const SetupCommand = cmd({
    command: "setup",
    describe: "setup atomcli dependencies (Playwright browsers)",
    builder: (yargs: Argv) =>
        yargs.option("check", {
            describe: "only check status, don't install",
            type: "boolean",
            default: false,
        }),

    handler: async (argv) => {
        console.log(UI.logo())
        console.log("\n🔧 AtomCLI Setup\n")

        // Check Playwright availability
        console.log("📦 Checking Playwright availability...")
        const isAvailable = await Browser.isPlaywrightAvailable()

        if (isAvailable) {
            console.log("✅ Playwright is already installed and ready to use!")
            console.log("\n🌐 Browser tool is available for web automation.")
            return
        }

        console.log("❌ Playwright is not installed.")
        console.log("\n📥 The browser tool requires Playwright for web automation.")

        if (argv.check) {
            console.log("\n💡 Run without --check to install automatically.")
            return
        }

        // Ask for confirmation
        console.log("\n🚀 This will install:")
        console.log("   • playwright package (npm/bun)")
        console.log("   • Chromium browser binary (~100MB)")
        console.log("")

        const pwVersion = await resolveBundledPlaywrightVersion()
        const pwSpec = pwVersion ? `playwright@${pwVersion}` : "playwright"
        const pwPin = pwVersion ? ` (pinned to bundled v${pwVersion})` : ""

        const shouldInstall = await new Promise<boolean>((resolve) => {
            process.stdout.write("Install now? [Y/n] ")
            process.stdin.once("data", (data) => {
                const input = data.toString().trim().toLowerCase()
                resolve(input === "" || input === "y" || input === "yes")
            })
        })

        if (!shouldInstall) {
            console.log("\n❌ Installation cancelled.")
            console.log("\n💡 You can install manually later:")
            console.log(`   ${Browser.getInstallHint()}`)
            return
        }

        console.log("\n⏳ Installing Playwright...")

        try {
            // Try bun first, fall back to npm
            try {
                console.log(`📦 Installing playwright package via bun${pwPin}...`)
                await $`bun add -g ${pwSpec}`.quiet()
            } catch {
                console.log(`📦 Installing playwright package via npm${pwPin}...`)
                await $`npm install -g ${pwSpec}`.quiet()
            }

            console.log("🌐 Installing Chromium browser...")
            try {
                await $`bunx playwright install chromium`.quiet()
            } catch {
                await $`npx playwright install chromium`.quiet()
            }

            // On Arch-based systems, install-deps is not available (apt-only).
            if (detectLinuxDistro() === "arch") {
                console.log("\n🔧 Arch-based system detected — skipping `install-deps` (apt-only).")
                console.log("   If the browser fails to launch, install system libraries:")
                console.log("   sudo pacman -S --needed nss nspr alsa-lib at-spi2-core cups dbus libdrm libxkbcommon libxcomposite libxdamage libxfixes libxrandr mesa libxss gtk3 gdk-pixbuf2 pango cairo wayland libxrender libxtst libxshmfence")
            }

            // Verify installation
            console.log("\n✅ Verifying installation...")
            // Clear cached availability so the re-check reflects the new install
            Browser.resetPlaywrightCheck()
            const nowAvailable = await Browser.isPlaywrightAvailable()

            if (nowAvailable) {
                console.log("\n🎉 Success! Playwright is now installed.")
                console.log("🌐 The browser tool is ready to use.")
                console.log("\n💡 Try it out:")
                console.log('   atomcli --message "browser: navigate to https://example.com"')
            } else {
                console.log("\n⚠️  Installation completed but verification failed.")
                console.log(`   ${Browser.getInstallHint()}`)
                console.log("🔄 Please restart atomcli and try again.")
            }
        } catch (e: any) {
            log.error("Installation failed", { error: e.message })
            console.log("\n❌ Installation failed:")
            console.log(`   ${e.message}`)
            console.log("\n💡 Try installing manually:")
            console.log(`   ${Browser.getInstallHint()}`)
            process.exit(1)
        }
    },
})
