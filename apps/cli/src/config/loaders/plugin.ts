import path from "path"
import { pathToFileURL } from "url"

const PLUGIN_GLOB = new Bun.Glob("{plugin,plugins}/*.{ts,js}")

export async function loadPlugin(dir: string) {
    const plugins: string[] = []

    for await (const item of PLUGIN_GLOB.scan({
        absolute: true,
        followSymlinks: true,
        dot: true,
        cwd: dir,
    })) {
        plugins.push(pathToFileURL(item).href)
    }
    return plugins
}
