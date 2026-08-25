import path from "path"
import fs from "fs/promises"
import z from "zod"
import { MobileBridge } from "@atomcli/companion"
import { CompanionTransfer } from "@/services/companion/transfer"
import { Instance } from "@/services/project/instance"
import { Filesystem } from "@/util/util/filesystem"
import { BashArity } from "@/util/permission/arity"
import { Tool } from "./tool"

const parameters = z.object({
  command: z.string().min(1).max(10_000).describe("Development server command to run"),
  port: z.number().int().min(1024).max(65535).describe("Port exposed to Tailscale and the local network"),
  title: z.string().min(1).max(200).optional().describe("Preview title shown in the Android companion"),
  workdir: z.string().max(4096).optional().describe("Working directory relative to the current project"),
})

export const CompanionPreviewTool = Tool.define<
  typeof parameters,
  { previewID: string; port: number; endpoints: string[] }
>("companion_preview", {
  description:
    "Start a managed development server and send its Tailscale/LAN preview links to the Android companion. The companion can open the site, inspect logs, and stop the process.",
  parameters,
  async execute(params, ctx) {
    const requestedDirectory = params.workdir ? path.resolve(Instance.directory, params.workdir) : Instance.directory
    const directory = await fs.realpath(requestedDirectory)
    if (!Filesystem.contains(Instance.directory, directory)) {
      await ctx.ask({
        permission: "external_directory",
        patterns: [directory],
        always: [path.join(directory, "*")],
        metadata: { directory },
      })
    }
    const commandName = params.command.trim().split(/\s+/)[0] ?? params.command
    await ctx.ask({
      permission: "bash",
      patterns: [params.command],
      always: [`${BashArity.prefix([commandName]).join(" ")} *`],
      metadata: { command: params.command, port: params.port },
    })
    if (MobileBridge.connectedClientCount() === 0) {
      throw new Error(
        "No Android companion is connected to this AtomCLI process. Open the app and verify that it shows Linked, then retry.",
      )
    }
    const preview = await CompanionTransfer.startPreview({
      command: params.command,
      port: params.port,
      title: params.title,
      sessionID: ctx.sessionID,
      directory,
    })
    return {
      title: `Preview ready on port ${preview.port}`,
      output: ["Preview sent to the Android Companion:", ...preview.endpoints].join("\n"),
      metadata: { previewID: preview.id, port: preview.port, endpoints: preview.endpoints },
    }
  },
})
