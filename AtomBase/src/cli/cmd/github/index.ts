// GitHub CLI Commands
// Entry point re-exporting all commands for backward compatibility

import { cmd } from "../cmd"
import { GithubInstallCommand } from "./install"
import { GithubRunCommand } from "./run"

// Re-export commands
export { GithubInstallCommand } from "./install"
export { GithubRunCommand } from "./run"

// Re-export types and utilities
export * from "./types"
export { parseGitHubRemote, extractResponseText } from "./utils"

// Main GitHub command
export const GithubCommand = cmd({
    command: "github",
    describe: "manage GitHub agent",
    builder: (yargs) => yargs.command(GithubInstallCommand).command(GithubRunCommand).demandCommand(),
    async handler() { },
})
