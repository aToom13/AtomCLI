// MCP CLI Commands
// Entry point re-exporting all commands

import { cmd } from "../cmd"
import { McpListCommand } from "./list"
import { McpAuthCommand, McpLogoutCommand } from "./auth"
import { McpAddCommand } from "./add"
import { McpDebugCommand } from "./debug"
import { McpInstallCommand } from "./install"
import { McpRemoveCommand } from "./remove"

// Re-export all commands
export { McpListCommand } from "./list"
export { McpAuthCommand, McpAuthListCommand, McpLogoutCommand } from "./auth"
export { McpAddCommand } from "./add"
export { McpDebugCommand } from "./debug"
export { McpInstallCommand } from "./install"
export { McpRemoveCommand } from "./remove"

// Re-export utilities
export * from "./utils"

// Main MCP command
export const McpCommand = cmd({
    command: "mcp",
    describe: "manage MCP (Model Context Protocol) servers",
    builder: (yargs) =>
        yargs
            .command(McpAddCommand)
            .command(McpInstallCommand)
            .command(McpRemoveCommand)
            .command(McpListCommand)
            .command(McpAuthCommand)
            .command(McpLogoutCommand)
            .command(McpDebugCommand)
            .demandCommand(),
    async handler() { },
})
