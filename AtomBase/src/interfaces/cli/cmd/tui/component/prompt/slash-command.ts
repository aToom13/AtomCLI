export namespace SlashCommand {
  export type Action =
    | "session.undo"
    | "session.redo"
    | "session.compact"
    | "session.unshare"
    | "session.rename"
    | "session.copy"
    | "session.export"
    | "session.timeline"
    | "session.fork"
    | "session.toggle.thinking"
    | "session.share"
    | "session.new"
    | "model.list"
    | "agent.list"
    | "session.list"
    | "atomcli.status"
    | "mcp.list"
    | "theme.switch"
    | "prompt.editor"
    | "provider.connect"
    | "help.show"
    | "command.show"
    | "mode.autonomous"
    | "mode.safe"
    | "app.exit"
    | "autoconf.open"
    | "smart-model.toggle"
    | "think.set"

  export type Info = {
    name: string
    aliases?: string[]
    description: string
    action: Action
    session?: boolean
    share?: boolean
  }

  const commands: Info[] = [
    { name: "undo", description: "undo the last message", action: "session.undo", session: true },
    { name: "redo", description: "redo the last message", action: "session.redo", session: true },
    {
      name: "compact",
      aliases: ["summarize"],
      description: "compact the session",
      action: "session.compact",
      session: true,
    },
    { name: "unshare", description: "unshare the session", action: "session.unshare", session: true, share: true },
    { name: "rename", description: "rename the session", action: "session.rename", session: true },
    { name: "copy", description: "copy the session transcript", action: "session.copy", session: true },
    { name: "export", description: "export the session transcript", action: "session.export", session: true },
    { name: "timeline", description: "jump to a message", action: "session.timeline", session: true },
    { name: "fork", description: "fork from a message", action: "session.fork", session: true },
    {
      name: "thinking",
      description: "toggle thinking visibility",
      action: "session.toggle.thinking",
      session: true,
    },
    { name: "share", description: "share the session", action: "session.share", session: true, share: true },
    { name: "new", description: "create a new session", action: "session.new" },
    { name: "models", aliases: ["model"], description: "choose a model", action: "model.list" },
    { name: "agents", description: "list agents", action: "agent.list" },
    {
      name: "session",
      aliases: ["resume", "continue"],
      description: "list sessions",
      action: "session.list",
    },
    { name: "status", description: "show provider and MCP status", action: "atomcli.status" },
    { name: "mcp", description: "configure MCP servers", action: "mcp.list" },
    { name: "theme", description: "switch theme", action: "theme.switch" },
    { name: "editor", description: "open the prompt in an editor", action: "prompt.editor" },
    { name: "connect", description: "connect a provider", action: "provider.connect" },
    { name: "help", description: "show keyboard help", action: "help.show" },
    { name: "commands", description: "show all commands", action: "command.show" },
    { name: "autonomous", description: "enable autonomous tool approvals", action: "mode.autonomous" },
    { name: "safe", description: "restore safe tool approvals", action: "mode.safe" },
    { name: "exit", aliases: ["quit", "q"], description: "exit AtomCLI", action: "app.exit" },
    { name: "autoconf", description: "configure model routing", action: "autoconf.open" },
    {
      name: "smart-model",
      aliases: ["smart_model"],
      description: "toggle smart model routing",
      action: "smart-model.toggle",
    },
    {
      name: "think",
      description: "set model thinking level (none/minimal/low/medium/high/max/xhigh/off)",
      action: "think.set",
    },
  ]

  export function list(input: { session: boolean; sharing: boolean }) {
    return commands.filter((command) => {
      if (command.session && !input.session) return false
      if (command.share && !input.sharing) return false
      return true
    })
  }

  export function parse(input: string, context: { session: boolean; sharing: boolean }) {
    const match = input.trim().match(/^\/([^\s]+)(?:\s+(.*))?$/s)
    if (!match) return
    const name = match[1].toLowerCase()
    const command = list(context).find((item) => item.name === name || item.aliases?.includes(name))
    if (!command) return
    return {
      command,
      arguments: match[2]?.trim() ?? "",
    }
  }
}
