import z from "zod"
import { Tool } from "./tool"
import { Browser } from "../browser"
import path from "path"
import { assertExternalDirectory } from "./external-directory"

const MAX_BROWSER_OUTPUT = 100_000
import { Instance } from "@/services/project/instance"
import fs from "fs/promises"

export const BrowserTool = Tool.define("browser", {
    description: `Control a real web browser to navigate, interact, and inspect web pages.
Use this tool to:
- Navigate to URLs
- Click elements (left/right/double click)
- Type text naturally (mimics human typing) or press specific keys
- Scroll the page or elements in any direction
- Drag and drop elements
- Take screenshots regarding visual analysis
- Read console logs and execute JavaScript
The browser stays open between calls, allowing sequential interactions.

NOTE: This tool requires Playwright to be installed. If not available, you'll see an error message with installation instructions.`,
    parameters: z.object({
        action: z.enum([
            "navigate",
            "click",
            "tap",
            "type",
            "press",
            "clear",
            "read",
            "screenshot",
            "scroll",
            "drag",
            "hover",
            "evaluate",
            "console_logs",
            "back",
            "forward",
            "reload",
            "close"
        ]).describe("Action to perform"),

        // Common parameters
        url: z.string().max(8192).optional().describe("URL to navigate to (required for 'navigate')"),
        selector: z.string().max(4096).optional().describe("CSS selector to interact with (required for click, type, press, clear, drag, hover)"),
        script: z.string().max(100_000).optional().describe("JavaScript code to execute (required for 'evaluate')"),

        // specific parameters
        text: z.string().max(100_000).optional().describe("Text to type (required for 'type')"),
        key: z.string().max(100).optional().describe("Key to press e.g. 'Enter', 'Control+C', 'ArrowDown' (required for 'press')"),
        delay: z.number().min(0).max(5_000).optional().describe("Delay between keystrokes in ms for 'type' (default: 50ms)"),

        // Click options
        button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button (default: left)"),
        clickCount: z.number().int().min(1).max(3).optional().describe("Number of clicks (default: 1, set 2 for double-click)"),

        // Scroll options
        direction: z.enum(["up", "down", "left", "right", "top", "bottom"]).optional().describe("Scroll direction (required for 'scroll')"),
        amount: z.number().min(1).max(100_000).optional().describe("Scroll amount in pixels (default: 500 for up/down)"),

        // Drag options
        targetSelector: z.string().max(4096).optional().describe("Target element selector to drop onto (required for 'drag')"),

        // new params
        name: z.string().max(200).optional().describe("Custom name for the screenshot file (without extension)"),
        workdir: z.string().max(4096).optional().describe("Absolute path to the working directory where .screenshots should be created"),

        // Screenshot
        fullPage: z.boolean().optional().describe("Capture full page screenshot (default: false)"),
    }),
    async execute(params, ctx) {
        if (params.action === "close") {
            await Browser.close()
            return { output: "Browser closed", title: "Browser: close", metadata: {} }
        }

        if (params.action === "console_logs") {
            const logs = Browser.getLogs()
            Browser.clearLogs()
            const output = logs.length > 0 ? logs.join("\n").slice(-MAX_BROWSER_OUTPUT) : "No console logs available."
            return {
                output,
                title: "Browser: console_logs",
                metadata: { count: logs.length },
            }
        }

        if (params.action === "navigate" && !params.url) throw new Error("URL is required for navigate")
        if (["click", "tap", "type", "clear", "drag", "hover"].includes(params.action) && !params.selector) {
            throw new Error(`Selector is required for ${params.action}`)
        }
        if (params.action === "type" && params.text === undefined) throw new Error("Text is required for type")
        if (params.action === "press" && !params.key) throw new Error("Key is required for press")
        if (params.action === "scroll" && !params.direction) throw new Error("Direction is required for scroll")
        if (params.action === "drag" && !params.targetSelector) throw new Error("TargetSelector is required for drag")
        if (params.action === "evaluate" && !params.script) throw new Error("Script is required for evaluate")

        // Check if Playwright is available before trying to use it
        const isAvailable = await Browser.isPlaywrightAvailable()
        if (!isAvailable) {
            return {
                output: `❌ Browser tool unavailable: Playwright is not installed or the Chromium executable is missing.

📦 To install Playwright, run one of these commands:
   • ${Browser.getInstallHint().split("\n").map((line) => line.trim().replace(/^•\\s*/, "")).join("\n   • ")}

🌐 Or visit: https://playwright.dev/docs/intro

💡 After installation, restart atomcli and the browser tool will work automatically.`,
                title: "Browser: Not Available",
                metadata: { error: "Playwright not installed" },
            }
        }

        if (params.action === "screenshot") {
            const targetWorkdir = params.workdir ? path.resolve(params.workdir) : Instance.directory
            await assertExternalDirectory(ctx, targetWorkdir, { kind: "directory" })
        }

        let permissionTarget = params.selector ?? params.action
        if (params.action === "navigate") {
            if (!params.url) throw new Error("URL is required for navigate")
            let target: URL
            try {
                target = new URL(params.url)
            } catch {
                throw new Error("A valid absolute URL is required for navigate")
            }
            if (target.protocol !== "http:" && target.protocol !== "https:") {
                throw new Error("Browser navigation supports only http:// and https:// URLs")
            }
            permissionTarget = target.toString()
        }
        await ctx.ask({
            permission: "browser",
            patterns: [`${params.action}:${permissionTarget}`],
            always: [`${params.action}:*`],
            metadata: { action: params.action, target: permissionTarget },
        })

        const page = await Browser.getPage()

        try {
            let result = ""
            let metadata: any = {}

            switch (params.action) {
                case "navigate":
                    if (!params.url) throw new Error("URL is required for navigate")
                    await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 30000 })
                    result = `Navigated to ${params.url}`
                    break

                case "click":
                    if (!params.selector) throw new Error("Selector is required for click")
                    await page.click(params.selector, {
                        button: params.button || "left",
                        clickCount: params.clickCount || 1,
                        delay: params.delay,
                    })
                    result = `Clicked ${params.selector}`
                    break

                case "tap":
                    if (!params.selector) throw new Error("Selector is required for tap")
                    await page.tap(params.selector)
                    result = `Tapped ${params.selector}`
                    break

                case "type":
                    if (!params.selector) throw new Error("Selector is required for type")
                    if (params.text === undefined) throw new Error("Text is required for type")
                    await page.type(params.selector, params.text, { delay: params.delay ?? 50 })
                    result = `Typed text into ${params.selector}`
                    break

                case "press":
                    if (!params.key) throw new Error("Key is required for press")
                    if (params.selector) {
                        await page.press(params.selector, params.key)
                    } else {
                        await page.keyboard.press(params.key)
                    }
                    result = `Pressed key ${params.key}`
                    break

                case "clear":
                    if (!params.selector) throw new Error("Selector is required for clear")
                    await page.fill(params.selector, "")
                    result = `Cleared ${params.selector}`
                    break

                case "read":
                    const content = params.selector
                        ? await page.locator(params.selector).evaluate((element, max) => (element.textContent ?? "").slice(0, max), MAX_BROWSER_OUTPUT)
                        : await page.evaluate((max) => document.documentElement.outerHTML.slice(0, max), MAX_BROWSER_OUTPUT)
                    result = content || "No content found"
                    break

                case "scroll":
                    if (!params.direction) throw new Error("Direction is required for scroll")
                    const amount = params.amount || 500
                    if (params.selector) {
                        const el = page.locator(params.selector)
                        if (params.direction === "top") await el.evaluate(e => e.scrollTop = 0)
                        else if (params.direction === "bottom") await el.evaluate(e => e.scrollTop = e.scrollHeight)
                        else if (params.direction === "up") await el.evaluate((e, a) => e.scrollTop -= a, amount)
                        else if (params.direction === "down") await el.evaluate((e, a) => e.scrollTop += a, amount)
                        else if (params.direction === "left") await el.evaluate((e, a) => e.scrollLeft -= a, amount)
                        else if (params.direction === "right") await el.evaluate((e, a) => e.scrollLeft += a, amount)
                    } else {
                        if (params.direction === "top") await page.evaluate(() => window.scrollTo(0, 0))
                        else if (params.direction === "bottom") await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
                        else if (params.direction === "up") await page.mouse.wheel(0, -amount)
                        else if (params.direction === "down") await page.mouse.wheel(0, amount)
                        else if (params.direction === "left") await page.mouse.wheel(-amount, 0)
                        else if (params.direction === "right") await page.mouse.wheel(amount, 0)
                    }
                    result = `Scrolled ${params.direction}`
                    break

                case "drag":
                    if (!params.selector || !params.targetSelector) throw new Error("Selector and TargetSelector required")
                    await page.dragAndDrop(params.selector, params.targetSelector)
                    result = `Dragged ${params.selector} to ${params.targetSelector}`
                    break

                case "hover":
                    if (!params.selector) throw new Error("Selector required for hover")
                    await page.hover(params.selector)
                    result = `Hovered over ${params.selector}`
                    break

                case "screenshot":
                    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
                    const name = params.name ? params.name.replace(/[^a-zA-Z0-9-_]/g, "_") : `screenshot-${timestamp}`
                    const filename = `${name}.png`

                    const targetWorkdir = params.workdir ? path.resolve(params.workdir) : Instance.directory
                    await assertExternalDirectory(ctx, targetWorkdir, { kind: "directory" })

                    const screenshotsDir = path.join(targetWorkdir, ".screenshots")

                    await fs.mkdir(screenshotsDir, { recursive: true })

                    const filepath = path.join(screenshotsDir, filename)

                    if (params.fullPage) {
                        const dimensions = await page.evaluate(() => ({
                            width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
                            height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
                        }))
                        if (dimensions.width > 32_767 || dimensions.height > 32_767 || dimensions.width * dimensions.height > 25_000_000) {
                            throw new Error(
                                `Full-page screenshot is too large (${dimensions.width}x${dimensions.height}); use a viewport screenshot instead`,
                            )
                        }
                    }

                    await page.screenshot({
                        path: filepath,
                        fullPage: params.fullPage
                    })

                    result = `Screenshot saved to ${filepath}`
                    metadata.screenshotPath = filepath
                    break

                case "back":
                    await page.goBack()
                    result = "Navigated back"
                    break

                case "forward":
                    await page.goForward()
                    result = "Navigated forward"
                    break

                case "reload":
                    await page.reload()
                    result = "Reloaded page"
                    break

                case "evaluate":
                    if (!params.script) throw new Error("Script is required for evaluate")
                    const evalResult = await page.evaluate(({ script, max }) => {
                        try {
                            // eslint-disable-next-line no-eval
                            const value = eval(script)
                            if (typeof value === "string") return value.slice(0, max)
                            try {
                                return JSON.stringify(value).slice(0, max)
                            } catch {
                                return String(value).slice(0, max)
                            }
                        } catch (e) {
                            return e instanceof Error ? e.message : String(e);
                        }
                    }, { script: params.script, max: MAX_BROWSER_OUTPUT });
                    result = String(evalResult)
                    break

            }

            if (!metadata.title) {
                metadata.title = (await page.title()).slice(0, 2_000)
                metadata.url = page.url().slice(0, 8_192)
            }

            return {
                output: result,
                title: `Browser: ${params.action}`,
                metadata,
            }

        } catch (e: any) {
            throw new Error(`Browser action '${params.action}' failed: ${e.message}`)
        }
    },
})
