import { Log } from "@/util/util/log"
import fs from "fs"
import path from "path"
import os from "os"
import { Global } from "@/core/global"

// Type-only imports for Playwright types
import type {
  Browser as PlaywrightBrowser,
  BrowserContext,
  BrowserContextOptions,
  ConsoleMessage,
  Dialog,
  Page,
  Request,
} from "playwright"

const MAX_BROWSER_EVENTS = 1_000
const DEFAULT_BROWSER_EVENT_LIMIT = 50

export type BrowserConsoleEvent = {
  id: number
  timestamp: number
  pageId: string
  type: string
  text: string
  url?: string
  line?: number
  column?: number
}

export type BrowserNetworkEvent = {
  id: number
  timestamp: number
  pageId: string
  method: string
  status?: number
  url: string
  error?: string
  resourceType: string
  duration?: number
}

export type BrowserDialogEvent = {
  id: number
  timestamp: number
  pageId: string
  type: string
  message: string
  defaultValue: string
  action: "accepted" | "dismissed"
}

export type BrowserEventFilters = {
  since?: number
  limit?: number
  urlPattern?: string
}

export type BrowserEmulation = {
  reset?: boolean
  device?: string
  width?: number
  height?: number
  locale?: string
  timezoneId?: string
  colorScheme?: "dark" | "light" | "no-preference"
  offline?: boolean
  latitude?: number
  longitude?: number
  accuracy?: number
}

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
  // A failed playwright scan is only cached briefly so an install performed
  // while atomcli is running gets picked up without a restart.
  private static readonly NEGATIVE_CACHE_TTL_MS = 30_000

  private static instance: BrowserManager
  private browser: PlaywrightBrowser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private observedPages = new WeakSet<Page>()
  private pageIds = new WeakMap<Page, string>()
  private pendingPageIds: string[] = []
  private pageCounter = 0
  private log = Log.create({ service: "browser" })
  private consoleLogs: string[] = []
  private networkLogs: Array<{ method: string; status?: number; url: string; error?: string }> = []
  private consoleEvents: BrowserConsoleEvent[] = []
  private networkEvents: BrowserNetworkEvent[] = []
  private dialogEvents: BrowserDialogEvent[] = []
  private requestStartedAt = new WeakMap<Request, number>()
  private eventCounter = 0
  private nextDialog:
    | {
        action: "accept" | "dismiss"
        promptText?: string
      }
    | undefined
  private tracing = false
  private launchedHeadless = false
  private contextOptions: BrowserContextOptions = { hasTouch: false }
  private playwrightAvailable: boolean | null = null
  private playwrightCheckedAt = 0
  private playwrightPath: string = "playwright"
  private playwrightVersion: string | null = null
  private playwrightExpectedExecutable: string | null = null
  private browserWindowClass = `atomcli-browser-${process.pid}`

  private constructor() {}

  public static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager()
    }
    return BrowserManager.instance
  }

  /**
   * Candidate module paths for playwright, ordered most-explicit first.
   * Compiled binaries resolve bare specifiers against Bun's virtual bunfs
   * filesystem instead of disk, so a plain import("playwright") fails there
   * even when a valid install sits next to the source tree — hence the
   * ATOMCLI_PLAYWRIGHT_PATH override and the node_modules walk-up from cwd.
   */
  private resolvePlaywrightCandidates(): string[] {
    const candidates = [
      // 1. Explicit runtime override
      process.env.ATOMCLI_PLAYWRIGHT_PATH,
      // 2. Standard dynamic import (local node_modules, NODE_PATH)
      "playwright",
      // 3. Explicit AtomCLI config directory used by all platform installers
      process.env.ATOMCLI_CONFIG_DIR
        ? path.join(process.env.ATOMCLI_CONFIG_DIR, "playwright", "node_modules", "playwright")
        : undefined,
      // 4. AtomCLI directory (where install.sh/install.ps1 install it)
      path.join(Global.Path.root, "playwright", "node_modules", "playwright"),
      // 5. Legacy XDG config directory (backward compatibility)
      path.join(
        process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
        "atomcli",
        "playwright",
        "node_modules",
        "playwright",
      ),
    ].filter((p): p is string => !!p)

    // 6. Walk up from cwd so binaries running inside a source checkout find
    // the workspace install on disk
    let dir = process.cwd()
    for (let depth = 0; depth < 8; depth++) {
      candidates.push(path.join(dir, "node_modules", "playwright"))
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }

    return [...new Set(candidates)]
  }

  /**
   * Check if Playwright is available without crashing
   * Searches multiple locations: local node_modules, config dir, and global
   */
  public async isPlaywrightAvailable(): Promise<boolean> {
    if (this.playwrightAvailable === true) return true
    if (
      this.playwrightAvailable === false &&
      Date.now() - this.playwrightCheckedAt < BrowserManager.NEGATIVE_CACHE_TTL_MS
    ) {
      return false
    }

    for (const modulePath of this.resolvePlaywrightCandidates()) {
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
      } catch {
        // Try next candidate path
      }
    }

    this.log.warn("Playwright not available in any known location", {
      searched: this.resolvePlaywrightCandidates(),
    })
    this.playwrightAvailable = false
    this.playwrightCheckedAt = Date.now()
    return false
  }

  /**
   * Get Playwright module dynamically from discovered path.
   * Falls back to the bare specifier when the discovered path fails to
   * import (e.g. cache invalidated between check and launch).
   */
  private async getPlaywright() {
    try {
      return await import(this.playwrightPath)
    } catch {
      this.playwrightPath = "playwright"
      return await import(this.playwrightPath)
    }
  }

  public getLogs(): string[] {
    return [...this.consoleLogs]
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

  private eventMatches(event: { id: number; url?: string }, filters?: BrowserEventFilters) {
    if (filters?.since !== undefined && event.id <= filters.since) return false
    if (filters?.urlPattern) {
      try {
        if (!new RegExp(filters.urlPattern, "i").test(event.url ?? "")) return false
      } catch {
        if (!(event.url ?? "").toLowerCase().includes(filters.urlPattern.toLowerCase())) return false
      }
    }
    return true
  }

  public getConsoleEvents(filters?: BrowserEventFilters & { level?: string }) {
    const limit = Math.max(1, Math.min(filters?.limit ?? DEFAULT_BROWSER_EVENT_LIMIT, 500))
    return this.consoleEvents
      .filter((event) => this.eventMatches(event, filters) && (!filters?.level || event.type === filters.level))
      .slice(-limit)
  }

  public getNetworkEvents(
    filters?: BrowserEventFilters & {
      status?: number
      failedOnly?: boolean
      resourceType?: string
    },
  ) {
    const limit = Math.max(1, Math.min(filters?.limit ?? DEFAULT_BROWSER_EVENT_LIMIT, 500))
    return this.networkEvents
      .filter(
        (event) =>
          this.eventMatches(event, filters) &&
          (filters?.status === undefined || event.status === filters.status) &&
          (!filters?.failedOnly || event.error !== undefined || (event.status ?? 0) >= 400) &&
          (!filters?.resourceType || event.resourceType === filters.resourceType),
      )
      .slice(-limit)
  }

  public getDialogEvents(filters?: Pick<BrowserEventFilters, "since" | "limit">) {
    const limit = Math.max(1, Math.min(filters?.limit ?? DEFAULT_BROWSER_EVENT_LIMIT, 500))
    return this.dialogEvents.filter((event) => filters?.since === undefined || event.id > filters.since).slice(-limit)
  }

  public getEventCursor() {
    return this.eventCounter
  }

  public clearEvents(kind?: "console" | "network" | "dialog") {
    if (!kind || kind === "console") {
      this.consoleEvents = []
      this.consoleLogs = []
    }
    if (!kind || kind === "network") {
      this.networkEvents = []
      this.networkLogs = []
    }
    if (!kind || kind === "dialog") this.dialogEvents = []
  }

  public prepareDialog(action: "accept" | "dismiss", promptText?: string) {
    this.nextDialog = { action, promptText }
  }

  private pageId(page: Page) {
    let id = this.pageIds.get(page)
    if (!id) {
      id = `tab-${++this.pageCounter}`
      this.pageIds.set(page, id)
    }
    return id
  }

  private pushEvent<T>(events: T[], event: T) {
    events.push(event)
    if (events.length > MAX_BROWSER_EVENTS) events.splice(0, events.length - MAX_BROWSER_EVENTS)
  }

  private consoleLocation(message: ConsoleMessage) {
    const location = message.location()
    return {
      url: location.url ? location.url.slice(0, 8_192) : undefined,
      line: location.lineNumber,
      column: location.columnNumber,
    }
  }

  private processAncestors(): number[] {
    const result: number[] = []
    const seen = new Set<number>()
    let pid = process.pid
    while (pid > 1 && !seen.has(pid)) {
      seen.add(pid)
      result.push(pid)
      try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8")
        const end = stat.lastIndexOf(")")
        if (end < 0) break
        const fields = stat
          .slice(end + 2)
          .trim()
          .split(/\s+/)
        const parent = Number(fields[1])
        if (!Number.isInteger(parent) || parent <= 0) break
        pid = parent
      } catch {
        break
      }
    }
    return result
  }

  private async hyprlandClients(): Promise<
    Array<{
      address: string
      pid: number
      class: string
      initialClass: string
      workspace: { id: number; name: string }
    }>
  > {
    if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) return []
    try {
      const clients = Bun.spawn(["hyprctl", "clients", "-j"], {
        stdout: "pipe",
        stderr: "ignore",
      })
      const output = await new Response(clients.stdout).text()
      if ((await clients.exited) !== 0) return []
      const parsed = JSON.parse(output)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  private async resolveHostWorkspace(): Promise<string | undefined> {
    const clients = await this.hyprlandClients()
    const byPID = new Map(clients.map((client) => [client.pid, client]))
    for (const pid of this.processAncestors()) {
      const client = byPID.get(pid)
      if (!client) continue
      if (Number.isInteger(client.workspace?.id) && client.workspace.id > 0) return String(client.workspace.id)
      if (client.workspace?.name) return `name:${client.workspace.name}`
    }
  }

  private async installBrowserWindowRule(workspace: string | undefined): Promise<boolean> {
    if (!workspace || !process.env.HYPRLAND_INSTANCE_SIGNATURE) return false

    const luaString = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`
    const rule = [
      "hl.window_rule({",
      `name = ${luaString(this.browserWindowClass)},`,
      `match = { class = ${luaString(`^${this.browserWindowClass}$`)} },`,
      `workspace = ${luaString(`${workspace} silent`)},`,
      "no_initial_focus = true,",
      `suppress_event = ${luaString("activate activatefocus")}`,
      "})",
    ].join(" ")

    try {
      const command = Bun.spawn(["hyprctl", "eval", rule], {
        stdout: "ignore",
        stderr: "ignore",
      })
      return (await command.exited) === 0
    } catch {
      return false
    }
  }

  private async moveBrowserToWorkspace(workspace: string | undefined) {
    if (!workspace || !process.env.HYPRLAND_INSTANCE_SIGNATURE) return

    for (let attempt = 0; attempt < 20; attempt++) {
      const client = (await this.hyprlandClients()).find(
        (item) => item.class === this.browserWindowClass || item.initialClass === this.browserWindowClass,
      )
      if (!client || !/^0x[\da-f]+$/i.test(client.address)) {
        await Bun.sleep(25)
        continue
      }

      const selector = `address:${client.address}`
      const move = Bun.spawn(
        [
          "hyprctl",
          "dispatch",
          `hl.dsp.window.move({ workspace = "${workspace}", follow = false, window = "${selector}" })`,
        ],
        { stdout: "ignore", stderr: "ignore" },
      )
      if ((await move.exited) === 0) return

      const legacy = Bun.spawn(["hyprctl", "dispatch", "movetoworkspacesilent", `${workspace},${selector}`], {
        stdout: "ignore",
        stderr: "ignore",
      })
      await legacy.exited
      return
    }
  }

  /**
   * Capture the currently focused desktop window and return a best-effort
   * restorer. Headed Chromium may request focus while launching; restoring
   * the previous window keeps browser automation from interrupting typing in
   * the terminal. Unsupported window managers simply return no restorer.
   */
  public async captureFocusRestorer(): Promise<(() => Promise<void>) | undefined> {
    if (process.platform !== "linux") return

    if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
      try {
        const active = Bun.spawn(["hyprctl", "activewindow", "-j"], {
          stdout: "pipe",
          stderr: "ignore",
        })
        const output = await new Response(active.stdout).text()
        if ((await active.exited) !== 0) return
        const address = JSON.parse(output)?.address
        if (typeof address !== "string" || !/^0x[\da-f]+$/i.test(address)) return
        return async () => {
          // Chromium can make its activation request just after launch()
          // resolves, so yield briefly before restoring the user's window.
          await Bun.sleep(50)
          const current = Bun.spawn(["hyprctl", "activewindow", "-j"], {
            stdout: "pipe",
            stderr: "ignore",
          })
          const currentOutput = await new Response(current.stdout).text()
          if ((await current.exited) !== 0) return
          const currentWindow = JSON.parse(currentOutput)
          if (
            currentWindow?.class !== this.browserWindowClass &&
            currentWindow?.initialClass !== this.browserWindowClass
          ) {
            return
          }

          const selector = `address:${address}`
          const restore = Bun.spawn(["hyprctl", "dispatch", `hl.dsp.focus({ window = "${selector}" })`], {
            stdout: "ignore",
            stderr: "ignore",
          })
          if ((await restore.exited) === 0) return

          // Hyprland <= 0.54 used the legacy hyprlang dispatcher syntax.
          const legacy = Bun.spawn(["hyprctl", "dispatch", "focuswindow", selector], {
            stdout: "ignore",
            stderr: "ignore",
          })
          await legacy.exited
        }
      } catch {
        return
      }
    }

    if (process.env.DISPLAY) {
      try {
        const active = Bun.spawn(["xdotool", "getactivewindow"], {
          stdout: "pipe",
          stderr: "ignore",
        })
        const windowID = (await new Response(active.stdout).text()).trim()
        if ((await active.exited) !== 0 || !/^\d+$/.test(windowID)) return
        return async () => {
          await Bun.sleep(50)
          const current = Bun.spawn(["xdotool", "getactivewindow", "getwindowclassname"], {
            stdout: "pipe",
            stderr: "ignore",
          })
          const currentClass = (await new Response(current.stdout).text()).trim()
          if ((await current.exited) !== 0 || currentClass !== this.browserWindowClass) return

          const restore = Bun.spawn(["xdotool", "windowactivate", "--sync", windowID], {
            stdout: "ignore",
            stderr: "ignore",
          })
          await restore.exited
        }
      } catch {
        return
      }
    }
  }

  private observePage(page: Page) {
    if (this.observedPages.has(page)) return
    this.observedPages.add(page)
    const pageId = this.pageId(page)
    page.on("console", (msg) => {
      const text = `[${msg.type()}] ${msg.text()}`.slice(0, 10_000)
      this.consoleLogs.push(text)
      if (this.consoleLogs.length > 500) this.consoleLogs.splice(0, this.consoleLogs.length - 500)
      this.pushEvent(this.consoleEvents, {
        id: ++this.eventCounter,
        timestamp: Date.now(),
        pageId,
        type: msg.type(),
        text: msg.text().slice(0, 10_000),
        ...this.consoleLocation(msg),
      })
      this.log.debug(`console: ${text}`)
    })
    page.on("pageerror", (err) => {
      const text = `[error] ${err.message}`.slice(0, 10_000)
      this.consoleLogs.push(text)
      if (this.consoleLogs.length > 500) this.consoleLogs.splice(0, this.consoleLogs.length - 500)
      this.pushEvent(this.consoleEvents, {
        id: ++this.eventCounter,
        timestamp: Date.now(),
        pageId,
        type: "error",
        text: err.message.slice(0, 10_000),
        url: page.url().slice(0, 8_192),
      })
      this.log.error(`pageerror: ${text}`)
    })
    page.on("request", (request) => {
      this.requestStartedAt.set(request, Date.now())
    })
    page.on("response", (response) => {
      const request = response.request()
      this.networkLogs.push({
        method: request.method(),
        status: response.status(),
        url: response.url().slice(0, 8_192),
      })
      if (this.networkLogs.length > 500) this.networkLogs.splice(0, this.networkLogs.length - 500)
      const startedAt = this.requestStartedAt.get(request)
      this.pushEvent(this.networkEvents, {
        id: ++this.eventCounter,
        timestamp: Date.now(),
        pageId,
        method: request.method(),
        status: response.status(),
        url: response.url().slice(0, 8_192),
        resourceType: request.resourceType(),
        duration: startedAt === undefined ? undefined : Date.now() - startedAt,
      })
    })
    page.on("requestfailed", (request) => {
      this.networkLogs.push({
        method: request.method(),
        url: request.url().slice(0, 8_192),
        error: request.failure()?.errorText,
      })
      if (this.networkLogs.length > 500) this.networkLogs.splice(0, this.networkLogs.length - 500)
      const startedAt = this.requestStartedAt.get(request)
      this.pushEvent(this.networkEvents, {
        id: ++this.eventCounter,
        timestamp: Date.now(),
        pageId,
        method: request.method(),
        url: request.url().slice(0, 8_192),
        error: request.failure()?.errorText,
        resourceType: request.resourceType(),
        duration: startedAt === undefined ? undefined : Date.now() - startedAt,
      })
    })
    page.on("dialog", async (dialog: Dialog) => {
      const prepared = this.nextDialog
      this.nextDialog = undefined
      const action = prepared?.action ?? "dismiss"
      try {
        if (action === "accept") await dialog.accept(prepared?.promptText)
        else await dialog.dismiss()
      } finally {
        this.pushEvent(this.dialogEvents, {
          id: ++this.eventCounter,
          timestamp: Date.now(),
          pageId,
          type: dialog.type(),
          message: dialog.message().slice(0, 10_000),
          defaultValue: dialog.defaultValue().slice(0, 10_000),
          action: action === "accept" ? "accepted" : "dismissed",
        })
      }
    })
    page.on("close", () => {
      if (this.page !== page) return
      const remaining = this.context?.pages().filter((candidate) => !candidate.isClosed()) ?? []
      this.page = remaining.at(-1) ?? null
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
    const distro = detectLinuxDistro()

    if (distro === "debian") return `bunx playwright${version} install --with-deps chromium`

    if (distro === "arch") {
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

    if (distro === "fedora") {
      const dnfDeps = [
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
      ].join(" ")
      return (
        base +
        `\n\nFedora/RHEL-based system detected. If Chromium reports missing libraries, install them with:\n` +
        `sudo dnf install ${dnfDeps}`
      )
    }

    return base
  }

  private async createContext() {
    const viewport = Object.prototype.hasOwnProperty.call(this.contextOptions, "viewport")
      ? this.contextOptions.viewport
      : this.launchedHeadless
        ? { width: 1280, height: 720 }
        : null
    this.context = await this.browser!.newContext({
      ...this.contextOptions,
      viewport,
    })
    this.context.setDefaultTimeout(30_000)
    this.context.setDefaultNavigationTimeout(30_000)
    this.context.on("page", (page) => {
      const restoredId = this.pendingPageIds.shift()
      if (restoredId) this.pageIds.set(page, restoredId)
      this.observePage(page)
    })

    await this.context.addInitScript(() => {
      if (typeof document === "undefined") return

      document.addEventListener(
        "click",
        (e) => {
          if (!document.body) return
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

  private async init() {
    // Check if Playwright is available first
    const available = await this.isPlaywrightAvailable()
    if (!available) {
      const version = this.playwrightVersion ? `@${this.playwrightVersion}` : ""
      const searched = this.resolvePlaywrightCandidates()
        .map((p) => `\n  - ${p}`)
        .join("")
      throw new Error(
        `Playwright module could not be resolved. Install it with: bunx playwright${version} install chromium` +
          `\nSearched locations:${searched}` +
          (process.env.ATOMCLI_PLAYWRIGHT_PATH
            ? ""
            : `\nOr point ATOMCLI_PLAYWRIGHT_PATH at an existing playwright install.`),
      )
    }

    // if (this.browser) return

    if (this.browser && !this.browser.isConnected()) {
      this.browser = null
      this.context = null
      this.page = null
    }

    // Tracked at init scope: the context viewport must match how the browser
    // was actually launched, including after the headless fallback.
    let headless =
      process.platform !== "darwin" &&
      process.platform !== "win32" &&
      !process.env.DISPLAY &&
      !process.env.WAYLAND_DISPLAY
    if (!this.browser) {
      const hostWorkspace = headless ? undefined : await this.resolveHostWorkspace()
      const hasWindowRule = headless ? false : await this.installBrowserWindowRule(hostWorkspace)
      const args: string[] =
        process.platform === "linux" && process.geteuid?.() === 0 ? ["--no-sandbox", "--disable-setuid-sandbox"] : []
      if (process.platform === "linux" && !headless) args.push(`--class=${this.browserWindowClass}`)
      try {
        const { chromium } = await this.getPlaywright()
        this.log.info("launching browser", { headless })
        this.browser = await chromium.launch({ headless, args })
      } catch (e: any) {
        this.log.warn("headed launch failed, falling back to headless", { error: e.message })
        headless = true
        const { chromium } = await this.getPlaywright()
        const headlessArgs = args.filter((arg) => !arg.startsWith("--class="))
        this.browser = await chromium.launch({ headless, args: headlessArgs }).catch((launchError: any) => {
          throw new Error(
            `Chromium launch failed after both headed and headless attempts: ${launchError?.message ?? launchError} (headed error was: ${e?.message ?? e})`,
          )
        })
      }
      this.launchedHeadless = headless
      if (!headless && !hasWindowRule) await this.moveBrowserToWorkspace(hostWorkspace)
    }

    if (!this.context) {
      await this.createContext()
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
    return this.page!
  }

  public async getContext(): Promise<BrowserContext> {
    await this.init()
    return this.context!
  }

  public getPageId(page: Page) {
    return this.pageId(page)
  }

  public activatePage(page: Page) {
    this.page = page
    this.observePage(page)
    return page
  }

  public async getTabs() {
    await this.init()
    const pages = this.context!.pages()
    return Promise.all(
      pages.map(async (page, index) => ({
        index,
        id: this.pageId(page),
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
    if (!page)
      throw new Error(`Browser tab ${index} does not exist; available range is 0-${Math.max(0, pages.length - 1)}`)
    this.page = page
    this.observePage(page)
    return page
  }

  public async selectTabById(id: string): Promise<Page> {
    await this.init()
    const page = this.context!.pages().find((candidate) => this.pageId(candidate) === id)
    if (!page) throw new Error(`Browser tab '${id}' does not exist`)
    return this.activatePage(page)
  }

  public async newTab(url?: string, signal?: AbortSignal): Promise<Page> {
    await this.init()
    const page = await this.context!.newPage()
    this.activatePage(page)
    if (url) await page.goto(url, { waitUntil: "domcontentloaded", signal })
    return page
  }

  public async closeTab(input?: { id?: string; index?: number }): Promise<{ closed: string; active?: string }> {
    await this.init()
    const pages = this.context!.pages()
    const page = input?.id
      ? pages.find((candidate) => this.pageId(candidate) === input.id)
      : pages[input?.index ?? pages.indexOf(this.page!)]
    if (!page) throw new Error("Browser tab does not exist")
    const closed = this.pageId(page)
    await page.close()
    const remaining = this.context!.pages().filter((candidate) => !candidate.isClosed())
    this.page = remaining.at(-1) ?? null
    if (!this.page) {
      this.page = await this.context!.newPage()
      this.observePage(this.page)
    }
    return { closed, active: this.pageId(this.page) }
  }

  public async configureEmulation(options: BrowserEmulation, signal?: AbortSignal) {
    await this.init()
    if (this.tracing) throw new Error("Stop the active browser trace before changing emulation settings")
    const tabs = this.context!.pages().map((page) => ({
      id: this.pageId(page),
      url: page.url(),
      active: page === this.page,
    }))
    const storageState = await this.context!.storageState()
    let next: BrowserContextOptions = options.reset ? { hasTouch: false } : { ...this.contextOptions }

    if (options.device) {
      const { devices } = await this.getPlaywright()
      const descriptor = devices?.[options.device]
      if (!descriptor) {
        const available = Object.keys(devices ?? {})
          .slice(0, 40)
          .join(", ")
        throw new Error(`Unknown Playwright device '${options.device}'. Available devices include: ${available}`)
      }
      const { defaultBrowserType: _, ...contextDescriptor } = descriptor
      next = { ...next, ...contextDescriptor }
    }
    if (options.width !== undefined || options.height !== undefined) {
      const current = next.viewport && next.viewport !== null ? next.viewport : { width: 1280, height: 720 }
      next.viewport = {
        width: options.width ?? current.width,
        height: options.height ?? current.height,
      }
    }
    if (options.locale !== undefined) next.locale = options.locale
    if (options.timezoneId !== undefined) next.timezoneId = options.timezoneId
    if (options.colorScheme !== undefined) next.colorScheme = options.colorScheme
    if (options.offline !== undefined) next.offline = options.offline
    if (options.latitude !== undefined || options.longitude !== undefined) {
      if (options.latitude === undefined || options.longitude === undefined) {
        throw new Error("Both latitude and longitude are required for geolocation")
      }
      next.geolocation = {
        latitude: options.latitude,
        longitude: options.longitude,
        accuracy: options.accuracy,
      }
      next.permissions = [...new Set([...(next.permissions ?? []), "geolocation"])]
    }

    next.storageState = storageState
    await this.context!.close()
    this.context = null
    this.page = null
    this.pendingPageIds = tabs.map((tab) => tab.id)
    const desiredOffline = next.offline
    this.contextOptions = desiredOffline ? { ...next, offline: false } : next
    try {
      await this.init()
      const pages = [this.page!]
      for (let index = 1; index < tabs.length; index++) pages.push(await this.context!.newPage())
      for (const [index, tab] of tabs.entries()) {
        if (/^https?:/i.test(tab.url)) {
          await pages[index].goto(tab.url, { waitUntil: "domcontentloaded", signal })
        }
      }
      this.page = pages[tabs.findIndex((tab) => tab.active)] ?? pages[0]
    } finally {
      this.pendingPageIds = []
    }
    if (desiredOffline !== undefined) await this.context!.setOffline(desiredOffline)
    this.contextOptions = next
    return this.page!
  }

  public async getCookies(urls?: string[]) {
    return (await this.getContext()).cookies(urls)
  }

  public async addCookies(cookies: Parameters<BrowserContext["addCookies"]>[0]) {
    await (await this.getContext()).addCookies(cookies)
  }

  public async clearCookies() {
    await (await this.getContext()).clearCookies()
  }

  public async getStorageState() {
    return (await this.getContext()).storageState({ indexedDB: true })
  }

  public async clearStorage() {
    await (await this.getContext()).setStorageState({ cookies: [], origins: [] })
  }

  public async startTrace(name?: string) {
    const context = await this.getContext()
    if (this.tracing) throw new Error("A browser trace is already active")
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false, name, title: name })
    this.tracing = true
  }

  public async stopTrace(filepath: string) {
    const context = await this.getContext()
    if (!this.tracing) throw new Error("No browser trace is active")
    await context.tracing.stop({ path: filepath })
    this.tracing = false
  }

  public async close() {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
      this.context = null
      this.page = null
      this.tracing = false
      this.nextDialog = undefined
      this.log.info("browser closed")
    }
  }

  /**
   * Drop cached availability/version state so the next isPlaywrightAvailable()
   * call re-scans the filesystem. Used after installing/upgrading playwright.
   */
  public resetPlaywrightCheck() {
    this.playwrightAvailable = null
    this.playwrightCheckedAt = 0
    this.playwrightPath = "playwright"
    this.playwrightVersion = null
    this.playwrightExpectedExecutable = null
  }
}

export const Browser = BrowserManager.getInstance()
