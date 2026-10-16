import path from "path"
import { RGBA } from "@opentui/core"
import { Global } from "@/core/global"
import { Filesystem } from "@/util/util/filesystem"

export type ThemeJson = {
  $schema?: string
  defs?: Record<string, `#${string}` | string>
  theme: Omit<Record<string, unknown>, "selectedListItemText" | "backgroundMenu"> & {
    selectedListItemText?: unknown
    backgroundMenu?: unknown
    thinkingOpacity?: number
  }
}

export namespace SystemTheme {
  export const id = "system"
  export const title = "Default System"

  export function mode(background: string): "dark" | "light" {
    const color = RGBA.fromHex(background)
    const luminance = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b
    return luminance > 0.5 ? "light" : "dark"
  }

  export function options(themeIDs: string[]) {
    return [
      id,
      ...themeIDs.filter((item) => item !== id).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    ]
  }

  export function withoutReserved<T>(themes: Record<string, T>) {
    return Object.fromEntries(Object.entries(themes).filter(([name]) => name !== id))
  }
}

const CUSTOM_THEME_GLOB = new Bun.Glob("themes/*.json")

export async function getCustomThemes() {
  const directories = [
    Global.Path.config,
    ...(await Array.fromAsync(
      Filesystem.up({
        targets: [".atomcli"],
        start: process.cwd(),
      }),
    )),
  ]

  const result: Record<string, ThemeJson> = {}
  for (const dir of directories) {
    for await (const item of CUSTOM_THEME_GLOB.scan({
      absolute: true,
      followSymlinks: true,
      dot: true,
      cwd: dir,
    })) {
      const name = path.basename(item, ".json")
      result[name] = await Bun.file(item).json()
    }
  }
  return result
}
