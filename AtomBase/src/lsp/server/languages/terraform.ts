import { spawn } from "child_process"
import path from "path"
import fs from "fs/promises"
import { $ } from "bun"
import { Global } from "../../../global"
import { Log } from "../../../util/log"
import { Flag } from "../../../flag/flag"
import { Archive } from "../../../util/archive"
import { NearestRoot } from "../common"
import type { Info } from "../types"

const log = Log.create({ service: "lsp.server.terraform" })

export const TerraformLS: Info = {
    id: "terraform",
    extensions: [".tf", ".tfvars"],
    root: NearestRoot([".terraform.lock.hcl", "terraform.tfstate", "*.tf"]),
    async spawn(root) {
        let bin = Bun.which("terraform-ls", {
            PATH: process.env["PATH"] + path.delimiter + Global.Path.bin,
        })

        if (!bin) {
            if (Flag.ATOMCLI_DISABLE_LSP_DOWNLOAD) return
            log.info("downloading terraform-ls from GitHub releases")

            const releaseResponse = await fetch("https://api.github.com/repos/hashicorp/terraform-ls/releases/latest")
            if (!releaseResponse.ok) {
                log.error("Failed to fetch terraform-ls release info")
                return
            }

            const release = (await releaseResponse.json()) as {
                tag_name?: string
                assets?: { name?: string; browser_download_url?: string }[]
            }
            const version = release.tag_name?.replace("v", "")
            if (!version) {
                log.error("terraform-ls release did not include a version tag")
                return
            }

            const platform = process.platform
            const arch = process.arch

            const tfArch = arch === "arm64" ? "arm64" : "amd64"
            const tfPlatform = platform === "win32" ? "windows" : platform

            const assetName = `terraform-ls_${version}_${tfPlatform}_${tfArch}.zip`

            const assets = release.assets ?? []
            const asset = assets.find((a) => a.name === assetName)
            if (!asset?.browser_download_url) {
                log.error(`Could not find asset ${assetName} in terraform-ls release`)
                return
            }

            const downloadResponse = await fetch(asset.browser_download_url)
            if (!downloadResponse.ok) {
                log.error("Failed to download terraform-ls")
                return
            }

            const tempPath = path.join(Global.Path.bin, assetName)
            await Bun.file(tempPath).write(downloadResponse)

            const ok = await Archive.extractZip(tempPath, Global.Path.bin)
                .then(() => true)
                .catch((error) => {
                    log.error("Failed to extract terraform-ls archive", { error })
                    return false
                })
            if (!ok) return
            await fs.rm(tempPath, { force: true })

            bin = path.join(Global.Path.bin, "terraform-ls" + (platform === "win32" ? ".exe" : ""))

            if (!(await Bun.file(bin).exists())) {
                log.error("Failed to extract terraform-ls binary")
                return
            }

            if (platform !== "win32") {
                await $`chmod +x ${bin}`.quiet().nothrow()
            }

            log.info(`installed terraform-ls`, { bin })
        }

        return {
            process: spawn(bin, ["serve"], {
                cwd: root,
            }),
            initialization: {
                experimentalFeatures: {
                    prefillRequiredFields: true,
                    validateOnSave: true,
                },
            },
        }
    },
}
