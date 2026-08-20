import { Log } from "@/util/util/log"
import fs from "fs"
import path from "path"
import os from "os"
import { Global } from "@/core/global"

// Type-only imports for Playwright types
import type { Browser as PlaywrightBrowser, BrowserContext, Page } from "playwright"

export type LinuxDistro = "debian" | "arch" | "fedora" | "other"

/**
 * Detect the Linux distribution family from /etc/os-release.
 * Returns null on non-Linux platforms.
 */
export function detectLinuxDistro(): LinuxDistro | null {
  if (process.platform !== "linux") return null
  try {
    const content = fs.readFileSync("/etc/os-release", "utf8")
    const id = content.match(/^ID=["']?([^"'\n]+)["']?$/m)?.[1] ?? ""
    const idLike = content.match(/^ID_LIKE=["']?([^"'\n]+)["']?$/m)?.[1] ?? ""
    const combined = `${id} ${idLike}`.toLowerCase()
    if (combined.includes("debian") || combined.includes("ubuntu")) return "debian"
    if (combined.includes("arch") || combined.includes("cachyos")) return "arch"
    if (combined.includes("fedora") || combined.includes("rhel") || combined.includes("centos")) return "fedora"
    return "other"
  } catch {
    return null
  }
}

/**
 * Resolve the playwright version pinned in the bundled AtomBase dependencies.
 * Falls back to null when playwright is not resolvable from this module graph.
 */
export async function resolveBundledPlaywrightVersion(): Promise<string | null> {
  try {
    const pkg = await import("playwright/package.json").catch(() => null)
    return pkg?.default?.version ?? pkg?.version ?? null
  } catch {
    return null
  }
}

export class BrowserManager {
  private static instance: BrowserManager
  private browser: PlaywrightBrowser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private observedPages = new WeakSet<Page>()
  private log = Log.create({ service: "browser" })
  private consoleLogs: string[] = []
  private networkLogs: Array<{ method: string; status?: number; url: string; error?: string }> = []
  private playwrightAvailable: boolean | null = null
  private playwrightPath: string = "playwright"
  private playwrightVersion: string | null = null
  private playwrightExpectedExecutable: string | null = null

  private constructor() {}

  public static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager()
    }
    return BrowserManager.instance
  }

  /**
   * Check if Playwright is available without crashing
   * Searches multiple locations: local node_modules, config dir, and global
   */
  public async isPlaywrightAvailable(): Promise<boolean> {
    if (this.playwrightAvailable !== null) {
      return this.playwrightAvailable
    }

    // List of potential playwright module paths
    const playwrightPaths = [
      // 1. Standard dynamic import (local node_modules, NODE_PATH)
      "playwright",
      // 2. AtomCLI directory (where install.sh installs it)
      path.join(Global.Path.root, "playwright", "node_modules", "playwright"),
      // 3. Legacy config directory (backward compatibility)
      path.join(
        process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
        "atomcli",
        "playwright",
        "node_modules",
        "playwright",
      ),
    ]

    for (const modulePath of playwrightPaths) {
      try {
        const pw = await import(modulePath)
        // Record the resolved playwright version for accurate install hints
        try {
          const pkg = await import(`${modulePath}/package.json`).catch(() => null)
          this.playwrightVersion = pkg?.default?.version ?? pkg?.version ?? null
        } catch {
          // version lookup is best-effort
        }
        // The module existing is not enough — the browser executable must be
        // present or launch will fail. Verify it eagerly so the tool reports a
        // clear "not available" state instead of crashing at launch.
        if (!pw.chromium) continue
        if (pw.chromium?.executablePath) {
          const expected = pw.chromium.executablePath()
          this.playwrightExpectedExecutable = expected
          if (!fs.existsSync(expected)) {
            this.log.warn(
              `chromium executable missing at ${expected} (playwright ${this.playwrightVersion ?? "unknown"})`,
            )
            continue
          }
        }
        this.playwrightAvailable = true
        this.playwrightPath = modulePath
        return true
      } catch (e) {
        // Try next path
      }
    }

    this.log.warn("Playwright not available in any known location")
    this.playwrightAvailable = false
    return false
  }

  /**
   * Get Playwright module dynamically from discovered path
   */
  private async getPlaywright() {
    const pw = await import(this.playwrightPath)
    return pw
  }

  public getLogs(): string[] {
    return this.consoleLogs
  }

  public clearLogs() {
    this.consoleLogs = []
  }

  public getNetworkLogs() {
    return [...this.networkLogs]
  }

  public clearNetworkLogs() {
    this.networkLogs = []
  }

  private observePage(page: Page) {
    if (this.observedPages.has(page)) return
    this.observedPages.add(page)
    page.on("console", (msg) => {
      const text = `[${msg.type()}] ${msg.text()}`.slice(0, 10_000)
      this.consoleLogs.push(text)
      if (this.consoleLogs.length > 500) this.consoleLogs.splice(0, this.consoleLogs.length - 500)
      this.log.debug(`console: ${text}`)
    })
    page.on("pageerror", (err) => {
      const text = `[error] ${err.message}`.slice(0, 10_000)
      this.consoleLogs.push(text)
      if (this.consoleLogs.length > 500) this.consoleLogs.splice(0, this.consoleLogs.length - 500)
      this.log.error(`pageerror: ${text}`)
    })
    page.on("response", (response) => {
      this.networkLogs.push({ method: response.request().method(), status: response.status(), url: response.url().slice(0, 8_192) })
      if (this.networkLogs.length > 500) this.networkLogs.splice(0, this.networkLogs.length - 500)
    })
    page.on("requestfailed", (request) => {
      this.networkLogs.push({ method: request.method(), url: request.url().slice(0, 8_192), error: request.failure()?.errorText })
      if (this.networkLogs.length > 500) this.networkLogs.splice(0, this.networkLogs.length - 500)
    })
  }

  /**
   * Version-pinned, distro-aware installation instructions.
   * Playwright's `install-deps` only supports Debian/Ubuntu via apt; on
   * Arch-based distros (CachyOS, EndeavourOS, Manjaro, ...) the system
   * libraries must be installed with pacman instead.
   */
  public getInstallHint(): string {
    const version = this.playwrightVersion ? `@${this.playwrightVersion}` : ""
    const base = `bunx playwright${version} install chromium`

    if (detectLinuxDistro() === "arch") {
      const pacmanDeps = [
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
      ].join(" ")
      return (
        base +
        `\n\n🔧 Arch-based system detected (${process.platform}):\n` +
        `   Playwright's \`install-deps\` only supports Debian/Ubuntu (apt). Install the\n` +
        `   browser system libraries with pacman instead:\n` +
        `   sudo pacman -S --needed ${pacmanDeps}`
      )
    }

    return base
  }

  private async init() {
    // Check if Playwright is available first
    const available = await this.isPlaywrightAvailable()
    if (!available) {
      const version = this.playwrightVersion ? `@${this.playwrightVersion}` : ""
      const expectedExe = this.playwrightExpectedExecutable
        ? `\nExpected browser executable: ${this.playwrightExpectedExecutable}`
        : ""
      throw new Error(
        `Playwright is not available. Install its Chromium binary with: bunx playwright${version} install chromium${expectedExe}`,
      )
    }

    // if (this.browser) return

    if (this.browser && !this.browser.isConnected()) {
      this.browser = null
      this.context = null
      this.page = null
    }

    if (!this.browser) {
      try {
        const { chromium } = await this.getPlaywright()
        const headless =
          process.platform !== "darwin" &&
          process.platform !== "win32" &&
          !process.env.DISPLAY &&
          !process.env.WAYLAND_DISPLAY
        const args = process.platform === "linux" && process.geteuid?.() === 0
          ? ["--no-sandbox", "--disable-setuid-sandbox"]
          : []
        this.log.info("launching browser", { headless })
        this.browser = await chromium.launch({ headless, args })
      } catch (e: any) {
        this.log.warn("headed launch failed, falling back to headless", { error: e.message })
        const { chromium } = await this.getPlaywright()
        this.browser = await chromium.launch({
          headless: true,
          args:
            process.platform === "linux" && process.geteuid?.() === 0
              ? ["--no-sandbox", "--disable-setuid-sandbox"]
              : [],
        })
      }
    }

    if (!this.context) {
      this.context = await this.browser!.newContext({
        viewport: { width: 1280, height: 720 },
        hasTouch: true,
      })
      this.context.on("page", (page) => this.observePage(page))

      // Inject click visualization script
      await this.context.addInitScript(() => {
        if (typeof document === "undefined") return

        // Visual click effect
        document.addEventListener(
          "click",
          (e) => {
            const dot = document.createElement("div")
            dot.style.cssText = `
                position: absolute;
                width: 20px;
                height: 20px;
                background: rgba(64, 224, 208, 0.5);
                border: 2px solid #40E0D0;
                border-radius: 50%;
                pointer-events: none;
                z-index: 999999;
                left: ${e.pageX - 10}px;
                top: ${e.pageY - 10}px;
                transform: scale(0);
                transition: transform 0.2s, opacity 0.5s;
            `
            document.body.appendChild(dot)
            requestAnimationFrame(() => {
              dot.style.transform = "scale(1)"
            })
            setTimeout(() => {
              dot.style.opacity = "0"
            }, 300)
            setTimeout(() => {
              dot.remove()
            }, 800)
          },
          true,
        )
      })
    }

    if (!this.page || this.page.isClosed()) {
      this.page = await this.context!.newPage()
      this.observePage(this.page)
    }
  }

  public async getPage(): Promise<Page> {
    if (!this.page || this.page.isClosed()) {
      await this.init()
    }
    await this.page!.bringToFront()
    return this.page!
  }

  public async getTabs() {
    await this.init()
    const pages = this.context!.pages()
    return Promise.all(
      pages.map(async (page, index) => ({
        index,
        title: (await page.title().catch(() => "")).slice(0, 2_000),
        url: page.url().slice(0, 8_192),
        active: page === this.page,
      })),
    )
  }

  public async selectTab(index: number): Promise<Page> {
    await this.init()
    const pages = this.context!.pages()
    const page = pages[index]
    if (!page) throw new Error(`Browser tab ${index} does not exist; available range is 0-${Math.max(0, pages.length - 1)}`)
    this.page = page
    this.observePage(page)
    await page.bringToFront()
    return page
  }

  public async close() {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
      this.context = null
      this.page = null
      this.log.info("browser closed")
    }
  }

  /**
   * Drop cached availability/version state so the next isPlaywrightAvailable()
   * call re-scans the filesystem. Used after installing/upgrading playwright.
   */
  public resetPlaywrightCheck() {
    this.playwrightAvailable = null
    this.playwrightVersion = null
    this.playwrightExpectedExecutable = null
  }
}

export const Browser = BrowserManager.getInstance()
