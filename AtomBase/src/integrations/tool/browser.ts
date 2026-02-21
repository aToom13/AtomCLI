import z from "zod"
import { Tool } from "./tool"
import { Browser } from "../browser"
import path from "path"
import { existsSync, mkdirSync } from "fs"

const SCREENSHOT_DIR = path.join(process.cwd(), ".screenshots")
if (!existsSync(SCREENSHOT_DIR)) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true })
}

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
        url: z.string().optional().describe("URL to navigate to (required for 'navigate')"),
        selector: z.string().optional().describe("CSS selector to interact with (required for click, type, press, clear, drag, hover)"),
        script: z.string().optional().describe("JavaScript code to execute (required for 'evaluate')"),

        // specific parameters
        text: z.string().optional().describe("Text to type (required for 'type')"),
        key: z.string().optional().describe("Key to press e.g. 'Enter', 'Control+C', 'ArrowDown' (required for 'press')"),
        delay: z.number().optional().describe("Delay between keystrokes in ms for 'type' (default: 50ms)"),

        // Click options
        button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button (default: left)"),
        clickCount: z.number().optional().describe("Number of clicks (default: 1, set 2 for double-click)"),

        // Scroll options
        direction: z.enum(["up", "down", "left", "right", "top", "bottom"]).optional().describe("Scroll direction (required for 'scroll')"),
        amount: z.number().optional().describe("Scroll amount in pixels (default: 500 for up/down)"),

        // Drag options
        targetSelector: z.string().optional().describe("Target element selector to drop onto (required for 'drag')"),

        // new params
        name: z.string().optional().describe("Custom name for the screenshot file (without extension)"),
        workdir: z.string().optional().describe("Absolute path to the working directory where .screenshots should be created"),

        // Screenshot
        fullPage: z.boolean().optional().describe("Capture full page screenshot (default: false)"),
    }),
    async execute(params, ctx) {
        // Check if Playwright is available before trying to use it
        const isAvailable = await Browser.isPlaywrightAvailable()
        if (!isAvailable) {
            return {
                output: `❌ Browser tool unavailable: Playwright is not installed.

📦 To install Playwright, run one of these commands:
   • bun add -g playwright && bunx playwright install chromium
   • npm install -g playwright && npx playwright install chromium
   • yarn global add playwright && npx playwright install chromium

🌐 Or visit: https://playwright.dev/docs/intro

💡 After installation, restart atomcli and the browser tool will work automatically.`,
                title: "Browser: Not Available",
                metadata: { error: "Playwright not installed" },
            }
        }

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

                case "type":
                    if (!params.selector) throw new Error("Selector is required for type")
                    if (params.text === undefined) throw new Error("Text is required for type")
                    await page.type(params.selector, params.text, { delay: params.delay || 50 })
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
                    // If no selector, read full body
                    const content = params.selector
                        ? await page.textContent(params.selector)
                        : await page.content()
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
                        // left/right scroll on window is rare but valid
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

                    const screenshotsDir = params.workdir
                        ? path.join(params.workdir, ".screenshots")
                        : path.join(process.cwd(), ".screenshots")

                    if (!existsSync(screenshotsDir)) {
                        mkdirSync(screenshotsDir, { recursive: true })
                    }

                    const filepath = path.join(screenshotsDir, filename)

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
                    const evalResult = await page.evaluate((s) => {
                        try {
                            // eslint-disable-next-line no-eval
                            return eval(s);
                        } catch (e) {
                            return e instanceof Error ? e.message : String(e);
                        }
                    }, params.script);
                    result = typeof evalResult === 'object' ? JSON.stringify(evalResult) : String(evalResult)
                    break

                case "console_logs":
                    const logs = Browser.getLogs()
                    result = logs.length > 0 ? logs.join("\n") : "No console logs available."
                    Browser.clearLogs()
                    break

                case "close":
                    await Browser.close()
                    result = "Browser closed"
                    break
            }

            if (params.action !== "close" && !metadata.title) {
                metadata.title = await page.title()
                metadata.url = page.url()
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
