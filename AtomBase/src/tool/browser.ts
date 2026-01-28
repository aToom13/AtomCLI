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
The browser stays open between calls, allowing sequential interactions.`,
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

        // Screenshot
        fullPage: z.boolean().optional().describe("Capture full page screenshot (default: false)"),
    }),
    async execute(params, ctx) {
        const page = await Browser.getPage()

        try {
            let result = ""
            let metadata: any = {}

            switch (params.action) {
                case "navigate":
                    if (!params.url) throw new Error("URL is required for navigate")
                    await page.goto(params.url, { waitUntil: "domcontentloaded" })
                    result = `Navigated to ${params.url}`
                    break

                case "click":
                    if (!params.selector) throw new Error("Selector is required for click")
                    await page.click(params.selector, {
                        button: params.button || "left",
                        clickCount: params.clickCount || 1,
                        delay: 50
                    })
                    result = `Clicked ${params.selector} (button: ${params.button || "left"}, count: ${params.clickCount || 1})`
                    break

                case "type":
                    if (!params.selector || params.text === undefined) throw new Error("Selector and text are required for type")
                    await page.locator(params.selector).pressSequentially(params.text, {
                        delay: params.delay || 50
                    })
                    result = `Typed '${params.text}' into ${params.selector} (human-like)`
                    break

                case "press":
                    if (!params.key) throw new Error("Key is required for press")
                    if (params.selector) {
                        await page.press(params.selector, params.key)
                        result = `Pressed '${params.key}' on ${params.selector}`
                    } else {
                        await page.keyboard.press(params.key)
                        result = `Pressed '${params.key}' globally`
                    }
                    break

                case "clear":
                    if (!params.selector) throw new Error("Selector is required for clear")
                    await page.fill(params.selector, "")
                    result = `Cleared content of ${params.selector}`
                    break

                case "scroll":
                    const amount = params.amount || 500

                    if (params.direction === "top") {
                        await page.evaluate(() => window.scrollTo(0, 0))
                        result = "Scrolled to top"
                    } else if (params.direction === "bottom") {
                        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
                        result = "Scrolled to bottom"
                    } else if (params.selector) {
                        await page.hover(params.selector)
                        const x = params.direction === "right" ? amount : (params.direction === "left" ? -amount : 0)
                        const y = params.direction === "down" ? amount : (params.direction === "up" ? -amount : 0)
                        await page.mouse.wheel(x, y)
                        result = `Scrolled element ${params.selector} ${params.direction}`
                    } else {
                        let x = 0
                        let y = 0
                        switch (params.direction) {
                            case "up": y = -amount; break;
                            case "down": y = amount; break;
                            case "left": x = -amount; break;
                            case "right": x = amount; break;
                        }
                        await page.evaluate((args) => window.scrollBy(args.x, args.y), { x, y })
                        result = `Scrolled page ${params.direction} by ${amount}px`
                    }
                    break

                case "drag":
                    if (!params.selector || !params.targetSelector) throw new Error("Selector and targetSelector are required for drag")
                    await page.dragAndDrop(params.selector, params.targetSelector)
                    result = `Dragged ${params.selector} to ${params.targetSelector}`
                    break

                case "hover":
                    if (!params.selector) throw new Error("Selector is required for hover")
                    await page.hover(params.selector)
                    result = `Hovered over ${params.selector}`
                    break

                case "read":
                    const content = await page.evaluate(() => document.body.innerText)
                    result = content
                    metadata.url = page.url()
                    break

                case "screenshot":
                    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
                    const filename = `screenshot-${timestamp}.png`
                    const filepath = path.join(SCREENSHOT_DIR, filename)

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
