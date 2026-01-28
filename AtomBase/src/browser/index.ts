import { firefox, type Browser as PlaywrightBrowser, type BrowserContext, type Page } from "playwright"
import { Log } from "../util/log"
import fs from "fs"
import path from "path"

export class BrowserManager {
    private static instance: BrowserManager
    private browser: PlaywrightBrowser | null = null
    private context: BrowserContext | null = null
    private page: Page | null = null
    private log = Log.create({ service: "browser" })
    private screenshotDir = path.join(process.cwd(), ".screenshots")
    private consoleLogs: string[] = []

    private constructor() { }

    public static getInstance(): BrowserManager {
        if (!BrowserManager.instance) {
            BrowserManager.instance = new BrowserManager()
        }
        return BrowserManager.instance
    }

    public getLogs(): string[] {
        return this.consoleLogs
    }

    public clearLogs() {
        this.consoleLogs = []
    }

    private cleanScreenshots() {
        if (fs.existsSync(this.screenshotDir)) {
            try {
                this.log.info("clearing previous screenshots")
                fs.rmSync(this.screenshotDir, { recursive: true, force: true })
                fs.mkdirSync(this.screenshotDir, { recursive: true })
            } catch (e: any) {
                this.log.error("failed to clean screenshots", { error: e.message })
            }
        } else {
            fs.mkdirSync(this.screenshotDir, { recursive: true })
        }
    }

    private async init() {
        if (this.browser) return

        // Clean up old screenshots on new session start
        this.cleanScreenshots()

        try {
            this.log.info("launching browser (headed)")
            this.browser = await firefox.launch({
                headless: false,
                args: [],
            })
        } catch (e: any) {
            this.log.warn("headed launch failed, falling back to headless", { error: e.message })
            this.browser = await firefox.launch({
                headless: true,
                args: [],
            })
        }

        this.context = await this.browser.newContext({
            viewport: { width: 1280, height: 720 },
        })

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

        this.page = await this.context.newPage()

        // Improved logging for debug
        this.page.on("console", (msg) => {
            const text = `[${msg.type()}] ${msg.text()}`;
            this.consoleLogs.push(text);
            this.log.debug(`console: ${text}`);
        })
        this.page.on("pageerror", (err) => {
            const text = `[error] ${err.message}`;
            this.consoleLogs.push(text);
            this.log.error(`pageerror: ${text}`);
        })
    }

    public async getPage(): Promise<Page> {
        if (!this.page || this.page.isClosed()) {
            await this.init()
        }
        return this.page!
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
}

export const Browser = BrowserManager.getInstance()
