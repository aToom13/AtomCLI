import type { Argv } from "yargs"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Installation } from "@/services/installation"

export const UpgradeCommand = {
  command: ["update [target]", "upgrade [target]"],
  describe: "update atomcli and its runtime dependencies to the latest or a specific version",
  builder: (yargs: Argv) => {
    return yargs
      .positional("target", {
        describe: "version to upgrade to, for ex '0.1.48' or 'v0.1.48'",
        type: "string",
      })
      .option("method", {
        alias: "m",
        describe: "installation method to use",
        type: "string",
        choices: ["curl", "npm", "pnpm", "bun", "brew", "windows"],
      })
      .option("channel", {
        alias: "c",
        describe: "release channel (e.g., beta, alfa, rc, demo)",
        type: "string",
      })
  },
  handler: async (args: { target?: string; method?: string; channel?: string }) => {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro("Upgrade")
    const detectedMethod = await Installation.method()
    const method = (args.method as Installation.Method) ?? detectedMethod
    if (method === "unknown") {
      prompts.log.error(`atomcli is installed to ${process.execPath} and may be managed by a package manager`)
      const install = await prompts.select({
        message: "Install anyways?",
        options: [
          { label: "Yes", value: true },
          { label: "No", value: false },
        ],
        initialValue: false,
      })
      if (!install) {
        prompts.outro("Done")
        return
      }
    }
    prompts.log.info("Using method: " + method)

    let target: string

    if (args.target) {
      // Direct target specified via CLI arg
      target = args.target.replace(/^v/, "")
    } else {
      // Interactive version selection menu
      const spinner = prompts.spinner()
      spinner.start("Fetching available versions...")
      const releases = await Installation.listReleases(10)
      const latestVersion = await Installation.latest(undefined, args.channel)
      spinner.stop("Versions fetched")

      if (releases.length === 0) {
        // Fallback to latest if we can't get the list
        prompts.log.warn("Could not fetch version list, using latest")
        target = latestVersion
      } else {
        // Build options: latest first, then other releases, then "Build from Source"
        const options: { value: string; label: string; hint?: string }[] = []

        for (const version of releases) {
          const isCurrent = Installation.compareVersions(version, Installation.VERSION) === 0
          const isLatest = Installation.compareVersions(version, latestVersion) === 0
          const hints: string[] = []
          if (isLatest) hints.push("Latest")
          if (isCurrent) hints.push("Current")
          if (version.includes("-")) hints.push(version.split("-")[1]!)

          options.push({
            value: version,
            label: `v${version}`,
            hint: hints.length > 0 ? hints.join(", ") : undefined,
          })
        }

        options.push({
          value: "__source__",
          label: "🔧 Build from Source",
          hint: "Clone & compile latest from main branch",
        })

        const selected = await prompts.select({
          message: "Select version to install:",
          options,
          initialValue: latestVersion,
        })

        if (prompts.isCancel(selected)) {
          prompts.outro("Cancelled")
          return
        }

        if (selected === "__source__") {
          prompts.log.info("Building from source...")
          try {
            const proc = Bun.spawn(
              [
                "bash",
                "-c",
                "curl -fsSL https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.sh | bash -s -- --source",
              ],
              { stdout: "inherit", stderr: "inherit" },
            )
            await proc.exited
            if (proc.exitCode !== 0) {
              prompts.log.error("Build from source failed")
            } else {
              prompts.log.success("Build from source complete")
            }
          } catch (e) {
            prompts.log.error((e as Error).message)
          }
          prompts.outro("Done")
          return
        }

        target = selected as string
      }
    }

    if (Installation.compareVersions(Installation.VERSION, target) === 0) {
      prompts.log.warn(`atomcli update skipped: ${target} is already installed`)
      prompts.outro("Done")
      return
    }

    prompts.log.info(`From ${Installation.VERSION} → ${target}`)
    prompts.log.info("Starting verified update and runtime dependency repair...")
    const err = await Installation.upgrade(method, target).catch((err) => err)
    if (err) {
      if (err instanceof Installation.UpgradeFailedError) prompts.log.error(err.data.stderr)
      else if (err instanceof Error) prompts.log.error(err.message)
      prompts.outro("Done")
      return
    }
    prompts.log.success("Update complete")
    prompts.outro("Done")
  },
}
