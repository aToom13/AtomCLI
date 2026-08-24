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
      console.log(`🌐 Installing Chromium with Bun${pwPin}...`)
      const distro = detectLinuxDistro()
      if (distro === "debian") await $`bunx ${pwSpec} install --with-deps chromium`.quiet()
      else await $`bunx ${pwSpec} install chromium`.quiet()

      // On Arch-based systems, install-deps is not available (apt-only).
      if (distro === "arch") {
        console.log("\n🔧 Arch-based system detected — skipping `install-deps` (apt-only).")
        console.log("   If the browser fails to launch, install system libraries:")
        console.log(
          "   sudo pacman -S --needed nss nspr alsa-lib at-spi2-core cups dbus libdrm libxkbcommon libxcomposite libxdamage libxfixes libxrandr mesa libxss gtk3 gdk-pixbuf2 pango cairo wayland libxrender libxtst libxshmfence",
        )
      } else if (distro === "fedora") {
        console.log("\n🔧 Fedora/RHEL-based system detected.")
        console.log("   If Chromium reports missing libraries, run:")
        console.log(
          "   sudo dnf install alsa-lib atk at-spi2-atk cups-libs gtk3 libdrm libX11 libXcomposite libXdamage libXext libXfixes libXrandr libxcb libxkbcommon mesa-libgbm nss pango",
        )
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
