import { Hono } from "hono"

// @ts-ignore - Import HTML
import html from "../dashboard/index.html" with { type: "text" }

// @ts-ignore - Import CSS files
import cssMain from "../dashboard/css/main.css" with { type: "text" }
import cssLayout from "../dashboard/css/layout.css" with { type: "text" }
import cssSidebar from "../dashboard/css/sidebar.css" with { type: "text" }
import cssTopbar from "../dashboard/css/topbar.css" with { type: "text" }
import cssContent from "../dashboard/css/content.css" with { type: "text" }
import cssComponents from "../dashboard/css/components.css" with { type: "text" }
import cssChat from "../dashboard/css/chat.css" with { type: "text" }
import cssResponsive from "../dashboard/css/responsive.css" with { type: "text" }

// @ts-ignore - Import JS files
import jsUtilities from "../dashboard/js/utilities.js" with { type: "text" }
import jsNavigation from "../dashboard/js/navigation.js" with { type: "text" }
import jsChat from "../dashboard/js/chat.js" with { type: "text" }
import jsPageLoaders from "../dashboard/js/pageLoaders.js" with { type: "text" }
import jsSse from "../dashboard/js/sse.js" with { type: "text" }
import jsModal from "../dashboard/js/modal.js" with { type: "text" }
import jsMain from "../dashboard/js/main.js" with { type: "text" }

// CSS files mapping
const cssFiles: Record<string, string> = {
  "main.css": cssMain as unknown as string,
  "layout.css": cssLayout as unknown as string,
  "sidebar.css": cssSidebar as unknown as string,
  "topbar.css": cssTopbar as unknown as string,
  "content.css": cssContent as unknown as string,
  "components.css": cssComponents as unknown as string,
  "chat.css": cssChat as unknown as string,
  "responsive.css": cssResponsive as unknown as string,
}

// JS files mapping
const jsFiles: Record<string, string> = {
  "utilities.js": jsUtilities as unknown as string,
  "navigation.js": jsNavigation as unknown as string,
  "chat.js": jsChat as unknown as string,
  "pageLoaders.js": jsPageLoaders as unknown as string,
  "sse.js": jsSse as unknown as string,
  "modal.js": jsModal as unknown as string,
  "main.js": jsMain as unknown as string,
}

export const DashboardRoute = new Hono()
  .get("/", (c) => {
    return c.html(html as unknown as string)
  })
  .get("/css/:filename", (c) => {
    const filename = c.req.param("filename")
    // Remove query string (e.g., ?v=6)
    const cleanFilename = filename.split("?")[0]
    const content = cssFiles[cleanFilename]

    if (!content) {
      return c.text("CSS file not found", 404)
    }

    return c.text(content, 200, {
      "Content-Type": "text/css",
      "Cache-Control": "public, max-age=3600",
    })
  })
  .get("/js/:filename", (c) => {
    const filename = c.req.param("filename")
    // Remove query string (e.g., ?v=6)
    const cleanFilename = filename.split("?")[0]
    const content = jsFiles[cleanFilename]

    if (!content) {
      return c.text("JavaScript file not found", 404)
    }

    return c.text(content, 200, {
      "Content-Type": "application/javascript",
      "Cache-Control": "public, max-age=3600",
    })
  })
