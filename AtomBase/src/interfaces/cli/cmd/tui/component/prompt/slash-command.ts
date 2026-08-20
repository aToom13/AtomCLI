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
    | "skill.list"
    | "session.list"
    | "atomcli.status"
    | "mcp.list"
    | "theme.switch"
    | "prompt.editor"
    | "provider.connect"
    | "help.show"
    | "workflow.prompt"
    | "mode.autonomous"
    | "mode.safe"
    | "autoconf.open"
    | "smart-model.toggle"
    | "think.set"
    | "group.help"

  export type Info = {
    name: string
    aliases?: string[]
    description: string
    action: Action
    session?: boolean
    share?: boolean
    acceptsArguments?: boolean
    presetArguments?: string
    children?: Info[]
    workflow?: {
      instruction: string
      requiresArguments?: boolean
      argumentHint?: string
    }
  }

  export type Suggestion = {
    command: Info
    value: string
    aliases: string[]
    expand: boolean
  }

  type Context = { session: boolean; sharing: boolean; thinkingLevels?: string[] }

  const sessionUndo: Info = {
    name: "undo",
    description: "undo the last message",
    action: "session.undo",
    session: true,
  }
  const sessionRedo: Info = {
    name: "redo",
    description: "redo the last message",
    action: "session.redo",
    session: true,
  }
  const sessionTimeline: Info = {
    name: "timeline",
    description: "jump to a message",
    action: "session.timeline",
    session: true,
  }
  const sessionFork: Info = { name: "fork", description: "fork from a message", action: "session.fork", session: true }
  const sessionCopy: Info = {
    name: "copy",
    description: "copy the session transcript",
    action: "session.copy",
    session: true,
  }
  const sessionExport: Info = {
    name: "export",
    description: "export the session transcript",
    action: "session.export",
    session: true,
  }
  const sessionShare: Info = {
    name: "share",
    description: "share the session",
    action: "session.share",
    session: true,
    share: true,
  }
  const sessionUnshare: Info = {
    name: "unshare",
    description: "remove the shared session link",
    action: "session.unshare",
    session: true,
    share: true,
  }

  const sessionChildren: Info[] = [
    { name: "list", aliases: ["switch"], description: "switch to another session", action: "session.list" },
    { name: "new", description: "create a new session", action: "session.new" },
    {
      name: "compact",
      aliases: ["summarize"],
      description: "compact session context",
      action: "session.compact",
      session: true,
    },
    { name: "rename", description: "rename the session", action: "session.rename", session: true },
    {
      name: "history",
      description: "undo, redo, inspect or fork session history",
      action: "group.help",
      children: [sessionUndo, sessionRedo, sessionTimeline, sessionFork],
    },
    {
      name: "transcript",
      description: "copy or export the session transcript",
      action: "group.help",
      children: [sessionCopy, sessionExport],
    },
    {
      name: "sharing",
      aliases: ["share"],
      description: "create or remove the session share link",
      action: "group.help",
      children: [sessionShare, sessionUnshare],
    },
  ]

  const thinkingLevels = ["none", "minimal", "low", "medium", "high", "max", "xhigh", "off"].map(
    (level): Info => ({
      name: level,
      description: level === "off" ? "reset to the model default" : `use ${level} thinking effort`,
      action: "think.set",
      presetArguments: level,
    }),
  )

  const smartRoutingOptions: Info[] = [
    {
      name: "on",
      aliases: ["enable"],
      description: "enable smart model routing",
      action: "smart-model.toggle",
      presetArguments: "on",
    },
    {
      name: "off",
      aliases: ["disable"],
      description: "disable smart model routing",
      action: "smart-model.toggle",
      presetArguments: "off",
    },
  ]

  const modelChildren: Info[] = [
    { name: "select", aliases: ["list"], description: "choose a model", action: "model.list" },
    {
      name: "think",
      aliases: ["reasoning"],
      description: "set model thinking level",
      action: "think.set",
      acceptsArguments: true,
      children: thinkingLevels,
    },
    {
      name: "visibility",
      aliases: ["thinking"],
      description: "toggle thinking visibility",
      action: "session.toggle.thinking",
      session: true,
    },
    {
      name: "smart",
      description: "configure smart model routing",
      action: "smart-model.toggle",
      children: smartRoutingOptions,
    },
    { name: "routing", aliases: ["autoconf"], description: "configure model routing", action: "autoconf.open" },
  ]

  const agentChildren: Info[] = [
    { name: "select", aliases: ["list"], description: "choose an agent", action: "agent.list" },
    { name: "skills", aliases: ["skill"], description: "list installed skills", action: "skill.list" },
  ]

  const approvalOptions: Info[] = [
    {
      name: "autonomous",
      aliases: ["auto"],
      description: "enable autonomous tool approvals",
      action: "mode.autonomous",
    },
    { name: "safe", description: "restore safe tool approvals", action: "mode.safe" },
  ]

  const settingsChildren: Info[] = [
    { name: "status", description: "show provider and MCP status", action: "atomcli.status" },
    { name: "auth", aliases: ["connect"], description: "connect a provider", action: "provider.connect" },
    { name: "mcp", description: "configure MCP servers", action: "mcp.list" },
    { name: "theme", description: "switch theme", action: "theme.switch" },
    {
      name: "approvals",
      aliases: ["mode"],
      description: "choose the tool approval mode",
      action: "group.help",
      children: approvalOptions,
    },
  ]

  const workflowChildren: Info[] = [
    {
      name: "review",
      description: "review the current workspace",
      action: "workflow.prompt",
      workflow: {
        instruction:
          "Review the current workspace changes. Find correctness, security, and regression risks, then verify your findings.",
      },
    },
    {
      name: "security",
      description: "run a security audit",
      action: "workflow.prompt",
      workflow: {
        instruction:
          "Perform a security audit of the current workspace. Prioritize exploitable findings and verify each result.",
      },
    },
    {
      name: "refactor",
      description: "refactor toward a stated goal",
      action: "workflow.prompt",
      acceptsArguments: true,
      workflow: {
        instruction: "Refactor the current workspace according to this goal:",
        requiresArguments: true,
        argumentHint: "goal",
      },
    },
    {
      name: "docs",
      description: "create or improve documentation",
      action: "workflow.prompt",
      acceptsArguments: true,
      workflow: {
        instruction: "Create or improve project documentation for:",
        requiresArguments: true,
        argumentHint: "topic",
      },
    },
    {
      name: "perf",
      description: "investigate a performance target",
      action: "workflow.prompt",
      acceptsArguments: true,
      workflow: {
        instruction: "Profile and improve this performance target, preserving behavior and reporting measurements:",
        requiresArguments: true,
        argumentHint: "target",
      },
    },
    {
      name: "tests",
      aliases: ["test-gen"],
      description: "generate meaningful tests",
      action: "workflow.prompt",
      acceptsArguments: true,
      workflow: {
        instruction: "Generate meaningful regression tests for:",
        requiresArguments: true,
        argumentHint: "scope",
      },
    },
    {
      name: "pr",
      description: "inspect a pull request",
      action: "workflow.prompt",
      acceptsArguments: true,
      workflow: {
        instruction: "Inspect and address pull request:",
        requiresArguments: true,
        argumentHint: "number or URL",
      },
    },
  ]

  const commands: Info[] = [
    {
      name: "session",
      aliases: ["sessions"],
      description: "session switching, history, transcripts and sharing",
      action: "session.list",
      children: sessionChildren,
    },
    {
      name: "model",
      aliases: ["models"],
      description: "model selection, thinking and routing",
      action: "model.list",
      children: modelChildren,
    },
    {
      name: "agent",
      aliases: ["agents"],
      description: "agent selection and skills",
      action: "agent.list",
      children: agentChildren,
    },
    {
      name: "settings",
      aliases: ["config"],
      description: "status, providers, MCP, theme and approval mode",
      action: "atomcli.status",
      children: settingsChildren,
    },
    {
      name: "workflow",
      aliases: ["work"],
      description: "review, security, refactor, docs, performance and tests",
      action: "group.help",
      children: workflowChildren,
    },
    { name: "help", description: "show keyboard help and command families", action: "help.show" },
  ]

  // Old flat names remain parse-only for compatibility. They never appear in autocomplete.
  const legacy: Info[] = [
    { name: "list", aliases: ["switch"], description: "switch to another session", action: "session.list" },
    { name: "new", description: "create a new session", action: "session.new" },
    sessionUndo,
    sessionRedo,
    {
      name: "compact",
      aliases: ["summarize"],
      description: "compact session context",
      action: "session.compact",
      session: true,
    },
    { name: "rename", description: "rename the session", action: "session.rename", session: true },
    sessionCopy,
    sessionExport,
    sessionTimeline,
    sessionFork,
    sessionShare,
    sessionUnshare,
    { name: "sessions", aliases: ["resume", "continue"], description: "list sessions", action: "session.list" },
    { name: "models", description: "choose a model", action: "model.list" },
    { name: "agents", description: "choose an agent", action: "agent.list" },
    { name: "skills", aliases: ["skill"], description: "list installed skills", action: "skill.list" },
    { name: "status", description: "show provider and MCP status", action: "atomcli.status" },
    { name: "auth", aliases: ["connect"], description: "connect a provider", action: "provider.connect" },
    { name: "mcp", description: "configure MCP servers", action: "mcp.list" },
    { name: "theme", description: "switch theme", action: "theme.switch" },
    ...approvalOptions,
    { name: "editor", description: "open the prompt in an editor", action: "prompt.editor" },
    { name: "autoconf", description: "configure model routing", action: "autoconf.open" },
    {
      name: "smart-model",
      aliases: ["smart_model"],
      description: "toggle smart model routing",
      action: "smart-model.toggle",
    },
    {
      name: "think",
      aliases: ["reasoning"],
      description: "set model thinking level",
      action: "think.set",
      acceptsArguments: true,
    },
    { name: "thinking", description: "toggle thinking visibility", action: "session.toggle.thinking", session: true },
    ...workflowChildren.map((command) =>
      command.name === "tests" ? { ...command, name: "test-gen", aliases: ["tests"] } : command,
    ),
  ]

  // These paths were visible before the third-level grouping and remain accepted without cluttering autocomplete.
  const compatibilityPaths: { path: string[]; command: Info }[] = [
    ...[
      sessionUndo,
      sessionRedo,
      sessionTimeline,
      sessionFork,
      sessionCopy,
      sessionExport,
      sessionShare,
      sessionUnshare,
    ].map((command) => ({
      path: ["session", command.name],
      command,
    })),
    ...approvalOptions.map((command) => ({ path: ["settings", command.name], command })),
  ]

  function available(command: Info, input: Context) {
    if (command.session && !input.session) return false
    if (command.share && !input.sharing) return false
    return true
  }

  function matches(command: Info, name: string) {
    return command.name === name || command.aliases?.includes(name)
  }

  function children(command: Info, context: Context) {
    return (command.children ?? [])
      .filter(
        (child) =>
          command.action !== "think.set" ||
          child.presetArguments === "off" ||
          !context.thinkingLevels ||
          context.thinkingLevels.includes(child.presetArguments ?? child.name),
      )
      .filter((child) => visible(child, context))
  }

  function visible(command: Info, context: Context): boolean {
    if (!available(command, context)) return false
    if (command.children?.length && children(command, context).length === 0) return false
    return true
  }

  function resolve(tokens: string[], context: Context) {
    if (!tokens.length) return
    let choices = list(context)
    let command: Info | undefined
    const path: string[] = []
    for (const token of tokens) {
      command = choices.find((candidate) => matches(candidate, token.toLowerCase()))
      if (!command) return
      path.push(command.name)
      choices = children(command, context)
    }
    return { command: command!, path }
  }

  export function renderWorkflow(command: Info, argumentsText: string) {
    if (!command.workflow) return undefined
    const args = argumentsText.trim()
    if (command.workflow.requiresArguments && !args) return undefined
    return args ? `${command.workflow.instruction}\n\n${args}` : command.workflow.instruction
  }

  export function list(input: Context) {
    return commands.filter((command) => visible(command, input))
  }

  export function reserved() {
    return new Set([
      ...commands.flatMap((command) => [command.name, ...(command.aliases ?? [])]),
      ...legacy.flatMap((command) => [command.name, ...(command.aliases ?? [])]),
    ])
  }

  export function suggestions(query: string, context: Context): Suggestion[] {
    const trailingSpace = /\s$/.test(query)
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (tokens.length < 2 && !trailingSpace) {
      return list(context).map((command) => ({
        command,
        value: command.name,
        aliases: command.aliases ?? [],
        expand: children(command, context).length > 0,
      }))
    }

    const parentTokens = trailingSpace ? tokens : tokens.slice(0, -1)
    const parent = resolve(parentTokens, context)
    if (!parent) return []
    const prefix = parent.path.join(" ")
    return children(parent.command, context).map((command) => ({
      command,
      value: `${prefix} ${command.name}`,
      aliases: (command.aliases ?? []).map((alias) => `${prefix} ${alias}`),
      expand: children(command, context).length > 0,
    }))
  }

  export function canComplete(query: string, context: Context) {
    const trailingSpace = /\s$/.test(query)
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!tokens.length) return false
    const parentTokens = trailingSpace ? tokens : tokens.slice(0, -1)
    const parent = resolve(parentTokens, context)
    return Boolean(parent && children(parent.command, context).length)
  }

  export function parse(input: string, context: Context) {
    const body = input.trim()
    if (!body.startsWith("/")) return
    const tokens = body.slice(1).trim().split(/\s+/).filter(Boolean)
    if (!tokens.length) return
    const normalized = tokens.map((token) => token.toLowerCase())

    const compatible = compatibilityPaths.find(
      (entry) => entry.path.every((part, index) => normalized[index] === part) && available(entry.command, context),
    )
    if (compatible && normalized.length >= compatible.path.length) {
      return { command: compatible.command, arguments: tokens.slice(compatible.path.length).join(" ") }
    }

    let command = list(context).find((candidate) => matches(candidate, normalized[0]))
    if (command) {
      let consumed = 1
      while (consumed < normalized.length) {
        const child = children(command, context).find((candidate) => matches(candidate, normalized[consumed]))
        if (!child) break
        command = child
        consumed++
      }

      if (command.action === "think.set" && command.children?.length && consumed < normalized.length) return
      const remaining = tokens.slice(consumed).join(" ")
      if (remaining && command.presetArguments) return
      if (remaining && !command.acceptsArguments) return
      return { command, arguments: command.presetArguments ?? remaining }
    }

    command = legacy.find((item) => available(item, context) && matches(item, normalized[0]))
    if (!command) return
    return {
      command,
      arguments: tokens.slice(1).join(" "),
    }
  }
}
