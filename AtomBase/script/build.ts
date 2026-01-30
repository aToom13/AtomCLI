#!/usr/bin/env bun

import solidPlugin from "../node_modules/@opentui/solid/scripts/solid-plugin"
import path from "path"
import fs from "fs"
import { $ } from "bun"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

import pkg from "../package.json"
import { Script } from "@atomcli/script"

const singleFlag = process.argv.includes("--single")
const baselineFlag = process.argv.includes("--baseline")
const skipInstall = process.argv.includes("--skip-install")

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}[] = [
    {
      os: "linux",
      arch: "arm64",
    },
    {
      os: "linux",
      arch: "x64",
    },
    {
      os: "linux",
      arch: "x64",
      avx2: false,
    },
    {
      os: "linux",
      arch: "arm64",
      abi: "musl",
    },
    {
      os: "linux",
      arch: "x64",
      abi: "musl",
    },
    {
      os: "linux",
      arch: "x64",
      abi: "musl",
      avx2: false,
    },
    {
      os: "darwin",
      arch: "arm64",
    },
    {
      os: "darwin",
      arch: "x64",
    },
    {
      os: "darwin",
      arch: "x64",
      avx2: false,
    },
    {
      os: "win32",
      arch: "x64",
    },
    {
      os: "win32",
      arch: "x64",
      avx2: false,
    },
  ]

const targets = singleFlag
  ? allTargets.filter((item) => {
    if (item.os !== process.platform || item.arch !== process.arch) {
      return false
    }

    // When building for the current platform, prefer a single native binary by default.
    // Baseline binaries require additional Bun artifacts and can be flaky to download.
    if (item.avx2 === false) {
      return baselineFlag
    }

    return true
  })
  : allTargets

await $`rm -rf dist`

const binaries: Record<string, string> = {}
if (!skipInstall) {
  await $`bun install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`
  await $`bun install --os="*" --cpu="*" @parcel/watcher@${pkg.dependencies["@parcel/watcher"]}`
}
for (const item of targets) {
  const name = [
    pkg.name,
    // changing to win32 flags npm for some reason
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.avx2 === false ? "baseline" : undefined,
    item.abi === undefined ? undefined : item.abi,
  ]
    .filter(Boolean)
    .join("-")
  console.log(`building ${name}`)
  await $`mkdir -p dist/${name}/bin`

  const parserWorker = fs.realpathSync(path.resolve(dir, "./node_modules/@opentui/core/parser.worker.js"))
  const workerPath = "./src/cli/cmd/tui/worker.ts"

  // Use platform-specific bunfs root path based on target OS
  const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
  const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")

  await Bun.build({
    conditions: ["browser"],
    tsconfig: "./tsconfig.json",
    plugins: [solidPlugin],
    sourcemap: "external",
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      //@ts-ignore (bun types aren't up to date)
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: name.replace(pkg.name, "bun") as any,
      outfile: `dist/${name}/bin/atomcli`,
      execArgv: [`--user-agent=atomcli/${Script.version}`, "--use-system-ca", "--"],
      windows: {},
    },
    entrypoints: ["./src/index.ts", parserWorker, workerPath],
    define: {
      ATOMCLI_VERSION: `'${Script.version}'`,
      OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
      ATOMCLI_WORKER_PATH: workerPath,
      ATOMCLI_CHANNEL: `'${Script.channel}'`,
      ATOMCLI_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "",
    },
    external: ["electron", "chromium-bidi", "playwright", "playwright-core", "@playwright/browser-chromium"],
  })

  await $`rm -rf ./dist/${name}/bin/tui`
  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: Script.version,
        os: [item.os],
        cpu: [item.arch],
      },
      null,
      2,
    ),
  )

  // Copy skills directories to be bundled with the binary
  // .atomcli and .claude are in the project root (one level up from AtomBase)
  const rootAtom = path.resolve(dir, "../.atomcli")
  const rootClaude = path.resolve(dir, "../.claude")

  console.log(`Checking for skills in ${rootAtom} and ${rootClaude}...`)

  if (fs.existsSync(rootAtom)) {
    console.log(`Copying .atomcli to dist/${name}/...`)
    await $`cp -r ${rootAtom} dist/${name}/`
  } else {
    console.log("WARNING: .atomcli directory not found at project root!")
  }

  if (fs.existsSync(rootClaude)) {
    console.log(`Copying .claude to dist/${name}/...`)
    await $`cp -r ${rootClaude} dist/${name}/`
  } else {
    console.log("WARNING: .claude directory not found at project root!")
  }

  binaries[name] = Script.version
}

export { binaries }
