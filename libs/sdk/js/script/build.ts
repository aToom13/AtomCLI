#!/usr/bin/env bun

import { $ } from "bun"
import fs from "node:fs/promises"
import os from "node:os"
import path from "path"
import { fileURLToPath } from "node:url"

import { createClient } from "@hey-api/openapi-ts"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const generateHome = await fs.mkdtemp(path.join(os.tmpdir(), "atomcli-sdk-build-"))
try {
  const openapi = await $`bun dev generate`
    .cwd(path.resolve(dir, "../../../AtomBase"))
    .env({ ...process.env, ATOMCLI_TEST_HOME: generateHome })
    .text()
  await fs.writeFile(path.join(dir, "openapi.json"), openapi)
} finally {
  await fs.rm(generateHome, { recursive: true, force: true })
}

await createClient({
  input: "./openapi.json",
  output: {
    path: "./src/v2/gen",
    tsConfigPath: path.join(dir, "tsconfig.json"),
    clean: true,
  },
  plugins: [
    {
      name: "@hey-api/typescript",
      exportFromIndex: false,
    },
    {
      name: "@hey-api/sdk",
      instance: "AtomcliClient",
      exportFromIndex: false,
      auth: false,
      paramsStructure: "flat",
    },
    {
      name: "@hey-api/client-fetch",
      exportFromIndex: false,
      baseUrl: "http://localhost:4096",
    },
  ],
})

await $`bun prettier --write src/v2`
const generatedClient = path.join(dir, "src/v2/gen/client/client.gen.ts")
const generatedSource = await fs.readFile(generatedClient, "utf8")
await fs.writeFile(generatedClient, generatedSource.replaceAll("@ts-expect-error", "@ts-ignore"))
await fs.rm(path.join(dir, "dist"), { recursive: true, force: true })
await $`bun tsc`
await fs.rm(path.join(dir, "openapi.json"), { force: true })
