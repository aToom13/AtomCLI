import { $ } from "bun"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

if (process.versions.bun !== expectedBunVersion) {
  throw new Error(`This script requires bun@${expectedBunVersion}, but you are using bun@${process.versions.bun}`)
}

// Read AtomBase version as the source of truth
const atomBasePath = path.resolve(import.meta.dir, "../../../AtomBase/package.json")
const atomBasePkg = await Bun.file(atomBasePath).json()
const BASE_VERSION = atomBasePkg.version as string

const env = {
  ATOMCLI_CHANNEL: process.env["ATOMCLI_CHANNEL"],
  ATOMCLI_BUMP: process.env["ATOMCLI_BUMP"],
  ATOMCLI_VERSION: process.env["ATOMCLI_VERSION"],
}

// Get short commit hash
const COMMIT_HASH = await $`git rev-parse --short HEAD`.text().then(x => x.trim()).catch(() => "unknown")

const CHANNEL = await (async () => {
  if (env.ATOMCLI_CHANNEL) return env.ATOMCLI_CHANNEL
  if (env.ATOMCLI_BUMP) return "latest"
  if (env.ATOMCLI_VERSION && !env.ATOMCLI_VERSION.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()

const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.ATOMCLI_VERSION) return env.ATOMCLI_VERSION

  // If preview (non-latest channel), append channel and hash
  // e.g. 2.0.0-main.a1b2c3d
  if (IS_PREVIEW) {
    return `${BASE_VERSION}-${CHANNEL}.${COMMIT_HASH}`
  }

  // If latest, usage base version directly
  return BASE_VERSION
})()

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
}
console.log(`atomcli script`, JSON.stringify(Script, null, 2))
