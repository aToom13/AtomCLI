import { Hono } from "hono"

const html = await Bun.file(new URL("../dashboard/index.html", import.meta.url).pathname).text()

export const DashboardRoute = new Hono()
    .get("/", (c) => {
        return c.html(html)
    })
