import fs from "fs/promises"
import path from "path"
import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Global } from "@/core/global"
import { Browser, detectLinuxDistro, resolveBundledPlaywrightVersion } from "@/integrations/browser"
import { Log } from "@/util/util/log"

const log = Log.create({ service: "setup" })
const ARCH_BROWSER_PACKAGES = [
  "nss",
  "nspr",
  "alsa-lib",
  "at-spi2-core",
  "cups",
  "dbus",
  "libdrm",
  "libxkbcommon",
  "libxcomposite",
  "libxdamage",
  "libxfixes",
  "libxrandr",
  "mesa",
  "libxss",
  "gtk3",
  "gdk-pixbuf2",
  "pango",
  "cairo",
  "wayland",
  "libxrender",
  "libxtst",
  "libxshmfence",
]
const FEDORA_BROWSER_PACKAGES = [
  "alsa-lib",
  "atk",
  "at-spi2-atk",
  "cups-libs",
  "gtk3",
  "libdrm",
  "libX11",
  "libXcomposite",
  "libXdamage",
  "libXext",
  "libXfixes",
  "libXrandr",
  "libxcb",
  "libxkbcommon",
  "mesa-libgbm",
  "nss",
  "pango",
]

async function run(command: string[], cwd?: string, capture = false) {
  const proc = Bun.spawn(command, {
    cwd,
    stdin: "inherit",
    stdout: capture ? "pipe" : "inherit",
    stderr: capture ? "pipe" : "inherit",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    capture ? new Response(proc.stdout).text() : "",
    capture ? new Response(proc.stderr).text() : "",
  ])
  if (exitCode !== 0) throw new Error(`${command[0]} exited with code ${exitCode}${stderr ? `: ${stderr.trim()}` : ""}`)
  return stdout
}

function privileged(command: string[]) {
  return process.platform === "linux" && process.geteuid?.() !== 0 ? ["sudo", ...command] : command
}

async function installLinuxBrowserDependencies(distro: ReturnType<typeof detectLinuxDistro>) {
  if (distro === "arch") {
    const probe = Bun.spawn(["pacman", "-T", ...ARCH_BROWSER_PACKAGES], { stdout: "pipe", stderr: "ignore" })
    const missing = (await new Response(probe.stdout).text()).trim().split(/\s+/).filter(Boolean)
    await probe.exited
    if (missing.length === 0) return
    UI.println(`   Installing ${missing.length} missing Arch/CachyOS browser libraries...`)
    await run(privileged(["pacman", "-S", "--needed", "--noconfirm", ...missing]))
    return
  }
  if (distro === "fedora") {
    UI.println("   Checking Fedora/RHEL browser libraries with dnf...")
    await run(privileged(["dnf", "install", "-y", ...FEDORA_BROWSER_PACKAGES]))
  }
}

async function browserHealth() {
  Browser.resetPlaywrightCheck()
  try {
    return { ok: true as const, details: await Browser.verifyInstallation() }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
  }
}

export const SetupCommand = cmd({
  command: "setup",
  describe: "install and verify AtomCLI runtime dependencies",
  builder: (yargs: Argv) =>
    yargs
      .option("check", {
        describe: "run a real browser launch check without installing",
        type: "boolean",
        default: false,
      })
      .option("yes", {
        alias: "y",
        describe: "install missing dependencies without confirmation",
        type: "boolean",
        default: false,
      }),

  handler: async (argv) => {
    UI.println(UI.logo())
    UI.println("\n🔧 AtomCLI Setup\n")
    UI.println("[1/4] Scanning the installed browser runtime...")
    const initial = await browserHealth()
    if (initial.ok) {
      UI.println(`✅ Playwright ${initial.details.version ?? "unknown"} launched successfully.`)
      UI.println(`   Module: ${initial.details.modulePath}`)
      UI.println(`   Chromium: ${initial.details.executablePath}`)
      return
    }

    UI.println("❌ Browser runtime is not ready.")
    UI.println(`   ${initial.error}`)
    if (argv.check) {
      UI.println("\n💡 Run `atomcli setup --yes` to repair it automatically.")
      return
    }

    const pwVersion = await resolveBundledPlaywrightVersion()
    const desiredVersion = pwVersion ?? "1.62.0"
    const runtimeDirectory = path.join(Global.Path.root, "playwright")
    if (!argv.yes) {
      UI.println(
        "\n🚀 This will install the release-matched Playwright package, Chromium, and missing system libraries.",
      )
      const shouldInstall = await new Promise<boolean>((resolve) => {
        process.stdout.write("Install now? [Y/n] ")
        process.stdin.once("data", (data) => {
          const input = data.toString().trim().toLowerCase()
          resolve(input === "" || input === "y" || input === "yes")
        })
      })
      if (!shouldInstall) {
        UI.println("\n❌ Installation cancelled.")
        return
      }
    }

    try {
      UI.println(`[2/4] Synchronizing Playwright ${desiredVersion} in ${runtimeDirectory}...`)
      await fs.mkdir(runtimeDirectory, { recursive: true })
      const packageFile = path.join(runtimeDirectory, "package.json")
      if (!(await Bun.file(packageFile).exists())) {
        await Bun.write(packageFile, `${JSON.stringify({ private: true }, null, 2)}\n`)
      }
      await run(["bun", "add", "--exact", `playwright@${desiredVersion}`], runtimeDirectory)

      UI.println("[3/4] Installing Chromium and platform dependencies...")
      const distro = detectLinuxDistro()
      await installLinuxBrowserDependencies(distro)
      const installArgs = ["bunx", "playwright", "install", "--no-shell", "chromium"]
      if (distro === "debian") installArgs.splice(3, 0, "--with-deps")
      await run(installArgs, runtimeDirectory)

      UI.println("[4/4] Launching a real Chromium probe...")
      const health = await browserHealth()
      if (!health.ok) throw new Error(health.error)
      UI.println("\n🎉 Browser automation runtime installed and verified.")
      UI.println(`   Playwright: ${health.details.version ?? desiredVersion}`)
      UI.println(`   Chromium: ${health.details.executablePath}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("Installation failed", { error: message })
      UI.println("\n❌ Automatic setup failed:")
      UI.println(`   ${message}`)
      UI.println("\n💡 Diagnostic install command:")
      UI.println(`   ${Browser.getInstallHint()}`)
      process.exitCode = 1
    }
  },
})
