import path from "path"
import fs from "fs/promises"
import z from "zod"
import { MobileBridge } from "@atomcli/companion"
import { CompanionTransfer } from "@/services/companion/transfer"
import { Instance } from "@/services/project/instance"
import { Tool } from "./tool"

const parameters = z.object({
  path: z.string().min(1).max(4096).describe("File or image path to send to the paired Android companion"),
  title: z.string().min(1).max(200).optional().describe("Short title shown in the companion Deck"),
})

export const CompanionSendTool = Tool.define<typeof parameters, { artifactID: string; name: string; size: number }>(
  "companion_send",
  {
    description:
      "Send a file or image from the current PC to the paired AtomCLI Android companion. The item appears in Deck with a preview and download/share controls.",
    parameters,
    async execute(params, ctx) {
      const resolved = await fs.realpath(path.resolve(Instance.directory, params.path))
      await ctx.ask({
        permission: "read",
        patterns: [resolved],
        always: [path.join(path.dirname(resolved), "*")],
        metadata: { path: resolved, destination: "Android Companion" },
      })
      if (MobileBridge.connectedClientCount() === 0) {
        throw new Error(
          "No Android companion is connected to this AtomCLI process. Open the app and verify that it shows Linked, then retry.",
        )
      }
      const artifact = await CompanionTransfer.shareFile({
        filePath: resolved,
        title: params.title,
        sessionID: ctx.sessionID,
      })
      return {
        title: `Sent ${artifact.name} to Android`,
        output: `${artifact.name} is available in the AtomCLI Companion Deck for 24 hours.`,
        metadata: { artifactID: artifact.id, name: artifact.name, size: artifact.size },
      }
    },
  },
)
