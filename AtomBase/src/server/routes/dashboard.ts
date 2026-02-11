import { Hono } from "hono"

// @ts-ignore
import html from "../dashboard/index.html" with { type: "text" }

export const DashboardRoute = new Hono()
    .get("/", (c) => {
        return c.html(html as unknown as string)
    })
