import fs from "fs/promises"
import path from "path"
import os from "os"

const app = "atomcli"

export namespace Global {
  export const Path = {
    // Allow override via ATOMCLI_TEST_HOME for test isolation
    get home() {
      return process.env.ATOMCLI_TEST_HOME || os.homedir()
    },
    get root() {
      return path.join(this.home, ".atomcli")
    },
    get data() {
      return path.join(this.root, "data")
    },
    get bin() {
      return path.join(this.root, "bin")
    },
    get log() {
      return path.join(this.root, "logs")
    },
    get cache() {
      return path.join(this.root, "cache")
    },
    get config() {
      return this.root  // Config files directly in ~/.atomcli/
    },
    get state() {
      return path.join(this.root, "state")
    },
    get skills() {
      return path.join(this.root, "skills")
    },
    get sessions() {
      return path.join(this.root, "sessions")
    },
    get plugins() {
      return path.join(this.root, "plugins")
    },
  }
}

async function initializeDirectories() {
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
}

const CACHE_VERSION = "16"

async function checkCacheVersion() {
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
    } catch (e) {
      // Cache directory cleanup failed - non-critical, will retry next launch
    }
    await Bun.file(path.join(Global.Path.cache, "version")).write(CACHE_VERSION)
  }
}

// Initialize directories and cache version
await initializeDirectories()
await checkCacheVersion()
