import { DataMaintenance } from "@/core/storage/maintenance"
import { Instance } from "@/services/project/instance"
import { cmd } from "../cmd"

export const StorageCommand = cmd({
  command: "storage",
  describe: "preview storage cleanup; --apply compacts legacy copies, expires diagnostics and collects unused data",
  builder: (yargs) =>
    yargs
      .option("apply", { type: "boolean", default: false, describe: "Apply cleanup (default: preview only)" })
      .option("all-projects", {
        type: "boolean",
        default: false,
        describe: "Include snapshot repositories for inactive projects",
      }),
  async handler(args) {
    // A preview must not bootstrap background maintenance (or plugins/LSP).
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        try {
          const result = await DataMaintenance.run(args.apply, args["all-projects"])
          process.stdout.write(JSON.stringify(result, null, 2) + "\n")
          if (result.blocked) process.exitCode = 1
        } finally {
          await Instance.dispose()
        }
      },
    })
  },
})
