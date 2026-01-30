import fs from "fs/promises"
import path from "path"
import os from "os"

const app = "atomcli"

// All AtomCLI files are stored under ~/.atomcli/
const root = path.join(os.homedir(), ".atomcli")
const data = path.join(root, "data")
const cache = path.join(root, "cache")
const config = root  // Config files directly in ~/.atomcli/
const state = path.join(root, "state")

export namespace Global {
  export const Path = {
    // Allow override via ATOMCLI_TEST_HOME for test isolation
    get home() {
      return process.env.ATOMCLI_TEST_HOME || os.homedir()
    },
    root,
    data,
    bin: path.join(root, "bin"),
    log: path.join(root, "logs"),
    cache,
    config,
    state,
    skills: path.join(root, "skills"),
    sessions: path.join(root, "sessions"),
    plugins: path.join(root, "plugins"),
  }
}

await Promise.all([
  fs.mkdir(Global.Path.root, { recursive: true }),
  fs.mkdir(Global.Path.data, { recursive: true }),
  fs.mkdir(Global.Path.config, { recursive: true }),
  fs.mkdir(Global.Path.state, { recursive: true }),
  fs.mkdir(Global.Path.log, { recursive: true }),
  fs.mkdir(Global.Path.bin, { recursive: true }),
  fs.mkdir(Global.Path.skills, { recursive: true }),
  fs.mkdir(Global.Path.sessions, { recursive: true }),
  fs.mkdir(Global.Path.plugins, { recursive: true }),
  fs.mkdir(Global.Path.cache, { recursive: true }),
])

const CACHE_VERSION = "16"

const version = await Bun.file(path.join(Global.Path.cache, "version"))
  .text()
  .catch(() => "0")

if (version !== CACHE_VERSION) {
  try {
    const contents = await fs.readdir(Global.Path.cache)
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Global.Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    )
  } catch (e) { }
  await Bun.file(path.join(Global.Path.cache, "version")).write(CACHE_VERSION)
}
