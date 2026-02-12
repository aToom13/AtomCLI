import { Hono } from "hono"
import { readFileSync, existsSync } from "fs"
import { join } from "path"

// @ts-ignore
import html from "../dashboard/index.html" with { type: "text" }

// Get dashboard directory path - Bun specific
const dashboardDir = join(__dirname, "../dashboard")

// MIME types for static files
const mimeTypes: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".eot": "application/vnd.ms-fontobject",
}

export const DashboardRoute = new Hono()
    .get("/", (c) => {
        return c.html(html as unknown as string)
    })
    .get("/css/:filename", (c) => {
        const filename = c.req.param("filename")
        try {
            const filePath = join(dashboardDir, "css", filename)
            if (!existsSync(filePath)) {
                return c.text("CSS file not found", 404)
            }
            const content = readFileSync(filePath, "utf-8")
            return c.text(content, 200, {
                "Content-Type": "text/css",
                "Cache-Control": "public, max-age=3600",
            })
        } catch (error) {
            console.error("Error loading CSS:", error)
            return c.text("CSS file not found", 404)
        }
    })
    .get("/js/:filename", (c) => {
        const filename = c.req.param("filename")
        try {
            const filePath = join(dashboardDir, "js", filename)
            if (!existsSync(filePath)) {
                return c.text("JavaScript file not found", 404)
            }
            const content = readFileSync(filePath, "utf-8")
            return c.text(content, 200, {
                "Content-Type": "application/javascript",
                "Cache-Control": "public, max-age=3600",
            })
        } catch (error) {
            console.error("Error loading JS:", error)
            return c.text("JavaScript file not found", 404)
        }
    })
    .get("/assets/*", (c) => {
        const path = c.req.param("*")
        try {
            const filePath = join(dashboardDir, "assets", path)
            if (!existsSync(filePath)) {
                return c.text("Asset not found", 404)
            }
            const content = readFileSync(filePath)
            const ext = path.substring(path.lastIndexOf("."))
            const mimeType = mimeTypes[ext] || "application/octet-stream"
            return c.body(content, 200, {
                "Content-Type": mimeType,
                "Cache-Control": "public, max-age=86400",
            })
        } catch (error) {
            console.error("Error loading asset:", error)
            return c.text("Asset not found", 404)
        }
    })
