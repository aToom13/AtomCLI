#!/usr/bin/env bun

import { Script } from "@atomcli/script"
import { $ } from "bun"

if (!Script.preview) {
  await $`gh release edit v${Script.version} --draft=false`
}

await $`bun install`

await $`gh release download --pattern "atomcli-linux-*64.tar.gz" --pattern "atomcli-darwin-*64.zip" -D dist`

await import(`../packages/atomcli/script/publish-registries.ts`)
