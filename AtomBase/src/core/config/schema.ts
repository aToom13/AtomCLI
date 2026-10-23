import z from "zod"
import { ModelsDev } from "@/integrations/provider/models"
import { LSPServer } from "@/integrations/lsp/server"
import { Log } from "@/util/util/log"

export namespace ConfigSchema {
  export const RouterPreferences = z.object({
    mode: z.enum(["speed", "balanced", "quality", "reasoning"]).optional(),
    allowed_models: z
      .array(z.string())
      .optional()
      .describe("Optional provider/model allowlist; omitted means all models from allowed providers"),
    allowed_providers: z
      .array(z.string())
      .optional()
      .describe("Providers that AtomCLI Auto may consider; defaults to all connected providers"),
    allow_paid_models: z
      .boolean()
      .optional()
      .default(false)
      .describe("Allow AtomCLI Auto to select verified models that are not explicitly free"),
    allow_paid_probes: z
      .boolean()
      .optional()
      .default(false)
      .describe("Allow automatic verification probes for models that are not explicitly free"),
    excluded_models: z.array(z.string()).optional().describe("Models to exclude from auto-routing selection"),
    model_ratings: z
      .record(
        z.string(),
        z.object({
          coding: z.number().min(-3).max(3).optional().default(0),
          documentation: z.number().min(-3).max(3).optional().default(0),
          analysis: z.number().min(-3).max(3).optional().default(0),
          general: z.number().min(-3).max(3).optional().default(0),
        }),
      )
      .optional()
      .describe("Per-model user ratings (-3 to +3) for each task category"),
    category_overrides: z
      .object({
        coding: z.string().optional(),
        documentation: z.string().optional(),
        analysis: z.string().optional(),
        general: z.string().optional(),
      })
      .optional()
      .describe("Force a specific model for a task category"),
    exploration_rate: z
      .number()
      .min(0)
      .max(0.5)
      .optional()
      .default(0)
      .describe("Controlled probability of exploring a non-top model; zero keeps routing deterministic"),
  })

  export const McpLocal = z
    .object({
      type: z.literal("local").describe("Type of MCP server connection"),
      command: z.string().array().describe("Command and arguments to run the MCP server"),
      environment: z
        .record(z.string(), z.string())
        .optional()
        .describe("Environment variables to set when running the MCP server"),
      enabled: z.boolean().optional().describe("Enable or disable the MCP server on startup"),
      timeout: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Timeout in ms for fetching tools from the MCP server. Defaults to 5000 (5 seconds) if not specified.",
        ),
    })
    .strict()
    .meta({
      ref: "McpLocalConfig",
    })

  export const McpOAuth = z
    .object({
      clientId: z
        .string()
        .optional()
        .describe("OAuth client ID. If not provided, dynamic client registration (RFC 7591) will be attempted."),
      clientSecret: z.string().optional().describe("OAuth client secret (if required by the authorization server)"),
      scope: z.string().optional().describe("OAuth scopes to request during authorization"),
    })
    .strict()
    .meta({
      ref: "McpOAuthConfig",
    })
  export type McpOAuth = z.infer<typeof McpOAuth>

  export const McpRemote = z
    .object({
      type: z.literal("remote").describe("Type of MCP server connection"),
      url: z.string().describe("URL of the remote MCP server"),
      enabled: z.boolean().optional().describe("Enable or disable the MCP server on startup"),
      headers: z.record(z.string(), z.string()).optional().describe("Headers to send with the request"),
      oauth: z
        .union([McpOAuth, z.literal(false)])
        .optional()
        .describe(
          "OAuth authentication configuration for the MCP server. Set to false to disable OAuth auto-detection.",
        ),
      timeout: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Timeout in ms for fetching tools from the MCP server. Defaults to 5000 (5 seconds) if not specified.",
        ),
    })
    .strict()
    .meta({
      ref: "McpRemoteConfig",
    })

  export const Mcp = z.discriminatedUnion("type", [McpLocal, McpRemote])
  export type Mcp = z.infer<typeof Mcp>

  export const PermissionAction = z.enum(["ask", "allow", "deny"]).meta({
    ref: "PermissionActionConfig",
  })
  export type PermissionAction = z.infer<typeof PermissionAction>

  export const PermissionObject = z.record(z.string(), PermissionAction).meta({
    ref: "PermissionObjectConfig",
  })
  export type PermissionObject = z.infer<typeof PermissionObject>

  export const PermissionRule = z.union([PermissionAction, PermissionObject]).meta({
    ref: "PermissionRuleConfig",
  })
  export type PermissionRule = z.infer<typeof PermissionRule>

  // Capture original key order before zod reorders, then rebuild in original order
  const permissionPreprocess = (val: unknown) => {
    if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      return { ...val, __originalKeys: Object.keys(val) }
    }
    return val
  }

  const permissionTransform = (x: unknown): Record<string, PermissionRule> => {
    if (typeof x === "string") return { "*": x as PermissionAction }
    const obj = x as { __originalKeys?: string[] } & Record<string, unknown>
    const { __originalKeys, ...rest } = obj
    if (!__originalKeys) return rest as Record<string, PermissionRule>
    const result: Record<string, PermissionRule> = {}
    for (const key of __originalKeys) {
      if (key in rest) result[key] = rest[key] as PermissionRule
    }
    return result
  }

  export const Permission = z
    .preprocess(
      permissionPreprocess,
      z
        .object({
          __originalKeys: z.string().array().optional(),
          read: PermissionRule.optional(),
          edit: PermissionRule.optional(),
          glob: PermissionRule.optional(),
          grep: PermissionRule.optional(),
          list: PermissionRule.optional(),
          bash: PermissionRule.optional(),
          task: PermissionRule.optional(),
          external_directory: PermissionRule.optional(),
          todowrite: PermissionAction.optional(),
          todoread: PermissionAction.optional(),
          question: PermissionAction.optional(),
          webfetch: PermissionAction.optional(),
          websearch: PermissionAction.optional(),
          codesearch: PermissionAction.optional().describe(
            "Deprecated compatibility key; code search now uses the websearch permission",
          ),
          lsp: PermissionRule.optional(),
          doom_loop: PermissionAction.optional(),
          chainupdate: PermissionAction.optional().describe(
            "Permission for chain progress bar updates (usually auto-allowed)",
          ),
          // MCP tool permissions - allows pattern matching for MCP tool names (e.g., "filesystem_read", "memory_create")
          mcp: PermissionRule.optional().describe(
            "Permission for MCP tool calls (pattern matches tool names like 'filesystem_read')",
          ),
        })
        .catchall(PermissionRule)
        .or(PermissionAction),
    )
    .transform(permissionTransform)
    .meta({
      ref: "PermissionConfig",
    })
  export type Permission = z.infer<typeof Permission>

  export const Command = z.object({
    template: z.string(),
    description: z.string().optional(),
    agent: z.string().optional(),
    model: z.string().optional(),
    subtask: z.boolean().optional(),
  })
  export type Command = z.infer<typeof Command>

  export const Agent = z
    .object({
      model: z.string().optional(),
      temperature: z.number().optional(),
      top_p: z.number().optional(),
      prompt: z.string().optional(),
      tools: z.record(z.string(), z.boolean()).optional().describe("@deprecated Use 'permission' field instead"),
      disable: z.boolean().optional(),
      description: z.string().optional().describe("Description of when to use the agent"),
      mode: z.enum(["subagent", "primary", "all"]).optional(),
      hidden: z
        .boolean()
        .optional()
        .describe("Hide this subagent from the @ autocomplete menu (default: false, only applies to mode: subagent)"),
      options: z.record(z.string(), z.any()).optional(),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color format")
        .optional()
        .describe("Hex color code for the agent (e.g., #FF5733)"),
      steps: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of agentic iterations before forcing text-only response"),
      maxSteps: z.number().int().positive().optional().describe("@deprecated Use 'steps' field instead."),
      permission: Permission.optional(),
    })
    .catchall(z.any())
    .transform((agent) => {
      const knownKeys = new Set([
        "name",
        "model",
        "prompt",
        "description",
        "temperature",
        "top_p",
        "mode",
        "hidden",
        "color",
        "steps",
        "maxSteps",
        "options",
        "permission",
        "disable",
        "tools",
      ])

      // Extract unknown properties into options
      const options: Record<string, unknown> = { ...agent.options }
      for (const [key, value] of Object.entries(agent)) {
        if (!knownKeys.has(key)) options[key] = value
      }

      // Convert legacy tools config to permissions
      const permission: Permission = {}
      for (const [tool, enabled] of Object.entries(agent.tools ?? {})) {
        const action = enabled ? "allow" : "deny"
        // write, edit all map to edit permission
        if (tool === "write" || tool === "edit") {
          permission.edit = action
        } else {
          permission[tool] = action
        }
      }
      Object.assign(permission, agent.permission)

      // Convert legacy maxSteps to steps
      const steps = agent.steps ?? agent.maxSteps

      return { ...agent, options, permission, steps } as typeof agent & {
        options?: Record<string, unknown>
        permission?: Permission
        steps?: number
      }
    })
    .meta({
      ref: "AgentConfig",
    })
  export type Agent = z.infer<typeof Agent>

  export const Keybinds = z
    .object({
      leader: z.string().optional().default("ctrl+x").describe("Leader key for keybind combinations"),
      app_exit: z.string().optional().default("ctrl+c,ctrl+d,<leader>q").describe("Exit the application"),
      editor_open: z.string().optional().default("<leader>e").describe("Open external editor"),
      theme_list: z.string().optional().default("<leader>t").describe("List available themes"),
      sidebar_toggle: z.string().optional().default("<leader>b").describe("Toggle sidebar"),
      scrollbar_toggle: z.string().optional().default("none").describe("Toggle session scrollbar"),
      username_toggle: z.string().optional().default("none").describe("Toggle username visibility"),
      status_view: z.string().optional().default("<leader>s").describe("View status"),
      session_export: z.string().optional().default("<leader>x").describe("Export session to editor"),
      session_new: z.string().optional().default("<leader>n").describe("Create a new session"),
      session_list: z.string().optional().default("<leader>l").describe("List all sessions"),
      session_timeline: z.string().optional().default("<leader>g").describe("Show session timeline"),
      session_fork: z.string().optional().default("none").describe("Fork session from message"),
      session_rename: z.string().optional().default("none").describe("Rename session"),
      session_share: z.string().optional().default("none").describe("Share current session"),
      session_unshare: z.string().optional().default("none").describe("Unshare current session"),
      session_interrupt: z.string().optional().default("escape").describe("Interrupt current session"),
      session_compact: z.string().optional().default("<leader>c").describe("Compact the session"),
      messages_page_up: z.string().optional().default("pageup").describe("Scroll messages up by one page"),
      messages_page_down: z.string().optional().default("pagedown").describe("Scroll messages down by one page"),
      messages_half_page_up: z.string().optional().default("ctrl+alt+u").describe("Scroll messages up by half page"),
      messages_half_page_down: z
        .string()
        .optional()
        .default("ctrl+alt+d")
        .describe("Scroll messages down by half page"),
      messages_first: z.string().optional().default("ctrl+g,home").describe("Navigate to first message"),
      messages_last: z.string().optional().default("ctrl+alt+g,end").describe("Navigate to last message"),
      messages_next: z.string().optional().default("none").describe("Navigate to next message"),
      messages_previous: z.string().optional().default("none").describe("Navigate to previous message"),
      messages_last_user: z.string().optional().default("none").describe("Navigate to last user message"),
      messages_copy: z.string().optional().default("<leader>y").describe("Copy message"),
      messages_undo: z.string().optional().default("<leader>u").describe("Undo message"),
      messages_redo: z.string().optional().default("<leader>r").describe("Redo message"),
      messages_toggle_conceal: z
        .string()
        .optional()
        .default("<leader>h")
        .describe("Toggle code block concealment in messages"),
      tool_details: z.string().optional().default("none").describe("Toggle tool details visibility"),
      model_list: z.string().optional().default("<leader>m").describe("List available models"),
      model_cycle_recent: z.string().optional().default("f2").describe("Next recently used model"),
      model_cycle_recent_reverse: z.string().optional().default("shift+f2").describe("Previous recently used model"),
      model_cycle_favorite: z.string().optional().default("none").describe("Next favorite model"),
      model_cycle_favorite_reverse: z.string().optional().default("none").describe("Previous favorite model"),
      command_list: z.string().optional().default("ctrl+p").describe("List available commands"),
      agent_list: z.string().optional().default("<leader>a").describe("List agents"),
      agent_cycle: z.string().optional().default("tab").describe("Next agent"),
      agent_cycle_reverse: z.string().optional().default("shift+tab").describe("Previous agent"),
      variant_cycle: z.string().optional().default("ctrl+t").describe("Cycle model variants"),
      input_clear: z.string().optional().default("ctrl+c").describe("Clear input field"),
      input_paste: z.string().optional().default("ctrl+v").describe("Paste from clipboard"),
      input_submit: z.string().optional().default("return").describe("Submit input"),
      input_newline: z
        .string()
        .optional()
        .default("shift+return,ctrl+return,alt+return,ctrl+j")
        .describe("Insert newline in input"),
      input_move_left: z.string().optional().default("left,ctrl+b").describe("Move cursor left in input"),
      input_move_right: z.string().optional().default("right,ctrl+f").describe("Move cursor right in input"),
      input_move_up: z.string().optional().default("up").describe("Move cursor up in input"),
      input_move_down: z.string().optional().default("down").describe("Move cursor down in input"),
      input_select_left: z.string().optional().default("shift+left").describe("Select left in input"),
      input_select_right: z.string().optional().default("shift+right").describe("Select right in input"),
      input_select_up: z.string().optional().default("shift+up").describe("Select up in input"),
      input_select_down: z.string().optional().default("shift+down").describe("Select down in input"),
      input_line_home: z.string().optional().default("ctrl+a").describe("Move to start of line in input"),
      input_line_end: z.string().optional().default("ctrl+e").describe("Move to end of line in input"),
      input_select_line_home: z
        .string()
        .optional()
        .default("ctrl+shift+a")
        .describe("Select to start of line in input"),
      input_select_line_end: z.string().optional().default("ctrl+shift+e").describe("Select to end of line in input"),
      input_visual_line_home: z.string().optional().default("alt+a").describe("Move to start of visual line in input"),
      input_visual_line_end: z.string().optional().default("alt+e").describe("Move to end of visual line in input"),
      input_select_visual_line_home: z
        .string()
        .optional()
        .default("alt+shift+a")
        .describe("Select to start of visual line in input"),
      input_select_visual_line_end: z
        .string()
        .optional()
        .default("alt+shift+e")
        .describe("Select to end of visual line in input"),
      input_buffer_home: z.string().optional().default("home").describe("Move to start of buffer in input"),
      input_buffer_end: z.string().optional().default("end").describe("Move to end of buffer in input"),
      input_select_buffer_home: z
        .string()
        .optional()
        .default("shift+home")
        .describe("Select to start of buffer in input"),
      input_select_buffer_end: z.string().optional().default("shift+end").describe("Select to end of buffer in input"),
      input_delete_line: z.string().optional().default("ctrl+shift+d").describe("Delete line in input"),
      input_delete_to_line_end: z.string().optional().default("ctrl+k").describe("Delete to end of line in input"),
      input_delete_to_line_start: z.string().optional().default("ctrl+u").describe("Delete to start of line in input"),
      input_backspace: z.string().optional().default("backspace,shift+backspace").describe("Backspace in input"),
      input_delete: z.string().optional().default("ctrl+d,delete,shift+delete").describe("Delete character in input"),
      input_undo: z.string().optional().default("ctrl+-,super+z").describe("Undo in input"),
      input_redo: z.string().optional().default("ctrl+.,super+shift+z").describe("Redo in input"),
      input_word_forward: z
        .string()
        .optional()
        .default("alt+f,alt+right,ctrl+right")
        .describe("Move word forward in input"),
      input_word_backward: z
        .string()
        .optional()
        .default("alt+b,alt+left,ctrl+left")
        .describe("Move word backward in input"),
      input_select_word_forward: z
        .string()
        .optional()
        .default("alt+shift+f,alt+shift+right")
        .describe("Select word forward in input"),
      input_select_word_backward: z
        .string()
        .optional()
        .default("alt+shift+b,alt+shift+left")
        .describe("Select word backward in input"),
      input_delete_word_forward: z
        .string()
        .optional()
        .default("alt+d,alt+delete,ctrl+delete")
        .describe("Delete word forward in input"),
      input_delete_word_backward: z
        .string()
        .optional()
        .default("ctrl+w,ctrl+backspace,alt+backspace")
        .describe("Delete word backward in input"),
      history_previous: z.string().optional().default("up").describe("Previous history item"),
      history_next: z.string().optional().default("down").describe("Next history item"),
      session_child_cycle: z.string().optional().default("<leader>right").describe("Next child session"),
      session_child_cycle_reverse: z.string().optional().default("<leader>left").describe("Previous child session"),
      session_parent: z.string().optional().default("<leader>up").describe("Go to parent session"),
      terminal_suspend: z.string().optional().default("ctrl+z").describe("Suspend terminal"),
      terminal_title_toggle: z.string().optional().default("none").describe("Toggle terminal title"),
      filetree_toggle: z.string().optional().default("ctrl+b").describe("Toggle file tree sidebar"),
      codepanel_toggle: z.string().optional().default("ctrl+e").describe("Toggle code panel"),
      tips_toggle: z.string().optional().default("<leader>h").describe("Toggle tips on home screen"),
      autofollow_toggle: z.string().optional().default("<leader>f").describe("Toggle auto-follow (live scroll)"),
    })
    .strict()
    .meta({
      ref: "KeybindsConfig",
    })

  export const TUI = z.object({
    scroll_speed: z.number().min(0.001).optional().describe("TUI scroll speed"),
    scroll_acceleration: z
      .object({
        enabled: z.boolean().describe("Enable scroll acceleration"),
      })
      .optional()
      .describe("Scroll acceleration settings"),
    diff_style: z
      .enum(["auto", "stacked"])
      .optional()
      .describe("Control diff rendering style: 'auto' adapts to terminal width, 'stacked' always shows single column"),
  })

  export const Server = z
    .object({
      port: z.number().int().positive().optional().describe("Port to listen on"),
      hostname: z.string().optional().describe("Hostname to listen on"),
      mdns: z.boolean().optional().describe("Enable mDNS service discovery"),
      cors: z.array(z.string()).optional().describe("Additional domains to allow for CORS"),
      auth: z.string().min(1).optional().describe("Bearer token required by the control-plane API"),
      companionPort: z.number().int().positive().optional().describe("Port for the scoped companion listener"),
    })
    .strict()
    .meta({
      ref: "ServerConfig",
    })

  export const Layout = z.enum(["auto", "stretch"]).meta({
    ref: "LayoutConfig",
  })
  export type Layout = z.infer<typeof Layout>

  export const Provider = ModelsDev.Provider.partial()
    .extend({
      whitelist: z.array(z.string()).optional(),
      blacklist: z.array(z.string()).optional(),
      models: z
        .record(
          z.string(),
          ModelsDev.Model.partial().extend({
            experimental: z.boolean().optional(),
            provider: z.object({ npm: z.string() }).optional(),
            variants: z
              .record(
                z.string(),
                z
                  .object({
                    disabled: z.boolean().optional().describe("Disable this variant for the model"),
                  })
                  .catchall(z.any()),
              )
              .optional()
              .describe("Variant-specific configuration"),
          }),
        )
        .optional(),
      options: z
        .object({
          apiKey: z.string().optional(),
          baseURL: z.string().optional(),
          enterpriseUrl: z.string().optional().describe("GitHub Enterprise URL for copilot authentication"),
          setCacheKey: z.boolean().optional().describe("Enable promptCacheKey for this provider (default false)"),
          timeout: z
            .union([
              z
                .number()
                .int()
                .positive()
                .describe(
                  "Timeout in milliseconds for requests to this provider. Default is 300000 (5 minutes). Set to false to disable timeout.",
                ),
              z.literal(false).describe("Disable timeout for this provider entirely."),
            ])
            .optional()
            .describe(
              "Timeout in milliseconds for requests to this provider. Default is 300000 (5 minutes). Set to false to disable timeout.",
            ),
        })
        .catchall(z.any())
        .optional(),
    })
    .strict()
    .meta({
      ref: "ProviderConfig",
    })
  export type Provider = z.infer<typeof Provider>

  export const RemoteHost = z
    .object({
      host: z.string().min(1).max(253),
      port: z.number().int().min(1).max(65535).optional().default(22),
      username: z.string().min(1).max(255),
      password: z.string().optional(),
      privateKey: z.string().optional(),
      passphrase: z.string().optional(),
      hostKey: z
        .string()
        .regex(/^SHA256:[A-Za-z0-9+/]+={0,2}$/, "Expected an OpenSSH SHA-256 host fingerprint")
        .optional(),
      connectTimeout: z.number().int().min(1).max(120_000).optional().default(15_000),
    })
    .strict()
    .refine((value) => Boolean(value.password || value.privateKey), {
      message: "Configure either password or privateKey authentication",
    })
  export type RemoteHost = z.infer<typeof RemoteHost>

  export const Info = z
    .object({
      $schema: z.string().optional().describe("JSON schema reference for configuration validation"),
      theme: z.string().optional().describe("Theme name to use for the interface"),
      keybinds: Keybinds.optional().describe("Custom keybind configurations"),
      logLevel: Log.Level.optional().describe("Log level"),
      tui: TUI.optional().describe("TUI specific settings"),
      server: Server.optional().describe("Server configuration for atomcli serve and web commands"),
      execution: z
        .object({
          sandbox: z.enum(["off", "prefer", "require"]).optional().default("off"),
          filesystem: z.enum(["read-only", "workspace-write", "full"]).optional().default("workspace-write"),
          network: z.enum(["deny", "allow"]).optional().default("allow"),
          environment: z.enum(["minimal", "filtered", "inherit"]).optional().default("minimal"),
          processVisibility: z.enum(["restricted", "inherit"]).optional().default("restricted"),
          envAllow: z.array(z.string()).optional().default([]),
        })
        .strict()
        .optional()
        .describe("OS process isolation policy for model-executed commands"),
      remote: z
        .object({
          hosts: z
            .record(z.string().min(1).max(100), RemoteHost)
            .optional()
            .default({})
            .describe(
              "Global-only SSH profiles. Project-defined profiles are ignored; use {env:VAR} or {file:path} for secrets.",
            ),
        })
        .strict()
        .optional()
        .describe("Remote SSH tool configuration. Credential profiles are read only from the global user config."),
      command: z
        .record(z.string(), Command)
        .optional()
        .describe("Command configuration, see https://atomcli.ai/docs/commands"),
      watcher: z
        .object({
          ignore: z.array(z.string()).optional(),
        })
        .optional(),
      plugin: z.string().array().optional(),
      snapshot: z.boolean().optional(),
      retention: z
        .object({
          enabled: z
            .boolean()
            .optional()
            .describe("Automatically collect unused storage blobs and snapshot objects (default: true)"),
          orphan_hours: z
            .number()
            .int()
            .min(1)
            .max(87600)
            .optional()
            .describe(
              "Minimum orphan grace period in hours (default: 24); retained conversations and rollback trees are never age-deleted",
            ),
          interval_hours: z
            .number()
            .int()
            .min(1)
            .max(8760)
            .optional()
            .describe("Automatic maintenance interval in hours (default: 24)"),
          replay: z
            .boolean()
            .optional()
            .describe("Persist duplicate model/tool replay payloads for diagnostics (default: false)"),
          snapshot_mib: z
            .number()
            .int()
            .min(1)
            .max(1048576)
            .optional()
            .describe(
              "Global snapshot capture budget in MiB (default: 1024); existing rollback data is never automatically evicted",
            ),
          snapshot_file_mib: z
            .number()
            .int()
            .min(1)
            .max(1024)
            .optional()
            .describe("Maximum file size captured in snapshots in MiB (default: 2)"),
          max_delete_mib: z
            .number()
            .int()
            .min(1)
            .max(1048576)
            .optional()
            .describe(
              "Storage blob deletion budget per pass in MiB (default: 1024); snapshot packing has no byte quota",
            ),
        })
        .strict()
        .optional(),
      memory: z
        .object({
          retrospective: z
            .boolean()
            .optional()
            .describe("Run an LLM retrospective at session close and persist what it learns (default: true)"),
        })
        .optional(),
      share: z
        .enum(["manual", "auto", "disabled"])
        .optional()
        .describe(
          "Control sharing behavior:'manual' allows manual sharing via commands, 'auto' enables automatic sharing, 'disabled' disables all sharing",
        ),
      autoshare: z
        .boolean()
        .optional()
        .describe("@deprecated Use 'share' field instead. Share newly created sessions automatically"),
      autoupdate: z
        .union([z.boolean(), z.literal("notify")])
        .optional()
        .describe(
          "Automatically update to the latest version. Set to true to auto-update, false to disable, or 'notify' to show update notifications",
        ),
      channel: z
        .enum(["stable", "beta", "alfa"])
        .optional()
        .describe(
          "Release channel for updates: 'stable' for production releases, 'beta' for beta versions, 'alfa' for alpha versions. Defaults to 'stable'",
        ),
      disabled_providers: z.array(z.string()).optional().describe("Disable providers that are loaded automatically"),
      enabled_providers: z
        .array(z.string())
        .optional()
        .describe("When set, ONLY these providers will be enabled. All other providers will be ignored"),
      model: z.string().describe("Model to use in the format of provider/model, eg anthropic/claude-2").optional(),
      small_model: z
        .string()
        .describe("Small model to use for tasks like title generation in the format of provider/model")
        .optional(),
      fallback: z
        .object({
          enabled: z.boolean().optional().default(true).describe("Enable fallback mechanism"),
          secondary: z.string().optional().describe("Secondary fallback model (e.g., atomcli/minimax-m2.5-free)"),
          tertiary: z.string().optional().describe("Tertiary fallback model (e.g., atomcli/gpt-5-nano)"),
        })
        .optional()
        .describe("Fallback model configuration for automatic model switching on errors"),
      default_agent: z
        .string()
        .optional()
        .describe(
          "Default agent to use when none is specified. Must be a primary agent. Falls back to 'build' if not set or if the specified agent is invalid.",
        ),
      username: z
        .string()
        .optional()
        .describe("Custom username to display in conversations instead of system username"),
      mode: z
        .object({
          build: Agent.optional(),
          plan: Agent.optional(),
        })
        .catchall(Agent)
        .optional()
        .describe("@deprecated Use `agent` field instead."),
      agent: z
        .object({
          // primary
          plan: Agent.optional(),
          build: Agent.optional(),
          agent: Agent.optional(),
          // subagent
          general: Agent.optional(),
          explore: Agent.optional(),
          // specialized
          title: Agent.optional(),
          summary: Agent.optional(),
          compaction: Agent.optional(),
        })
        .catchall(Agent)
        .optional()
        .describe("Agent configuration, see https://atomcli.ai/docs/agent"),
      agent_mode: z
        .enum(["safe", "autonomous"])
        .optional()
        .describe(
          "Agent execution mode: 'safe' requires confirmation per step, 'autonomous' runs fully without prompts",
        ),
      agent_retry: z
        .object({
          max_retries: z.number().int().positive().optional().default(3),
          ask_user_after: z.number().int().positive().optional().default(2),
        })
        .optional()
        .describe("Retry configuration for Agent mode"),
      review: z
        .object({
          auto: z
            .boolean()
            .optional()
            .describe("Spawn reviewer agents automatically during agent completion only when explicitly enabled"),
          enabled: z
            .boolean()
            .optional()
            .default(true)
            .describe(
              "Enable review policy evaluation. Advisory mode reports review recommendations without spawning reviewers.",
            ),
          max_attempts: z
            .number()
            .int()
            .positive()
            .optional()
            .default(3)
            .describe("Maximum consecutive FAIL verdicts before the review gate escalates to the user"),
          reviewer_count: z
            .number()
            .int()
            .min(1)
            .max(4)
            .optional()
            .default(1)
            .describe("Number of independent reviewer agents to run when review is explicitly required"),
          policy: z
            .enum(["advisory", "enforced", "adaptive", "always", "off"])
            .optional()
            .default("adaptive")
            .describe("Recommend review without spawning, enforce high-risk review, review every edit, or disable"),
          high_risk_patterns: z
            .array(z.string().max(500))
            .max(100)
            .optional()
            .default([])
            .describe("Additional regular expressions that mark edited paths as high risk"),
        })
        .passthrough()
        .optional()
        .describe("Optional independent review; automatic review requires explicit auto opt-in"),
      execution_budget: z
        .object({
          max_calls: z.number().int().positive().optional(),
          max_steps: z.number().int().positive().optional(),
          max_duration_ms: z.number().int().positive().optional(),
          max_cost_usd: z.number().finite().positive().optional(),
          session_max_cost_usd: z.number().finite().positive().optional(),
          project_max_cost_usd: z.number().finite().positive().optional(),
          unknown_price: z.enum(["block", "allow"]).optional().default("block"),
        })
        .optional()
        .describe("Shared call, step, duration, and cost limits for a root execution and its child agents"),
      provider: z
        .record(z.string(), Provider)
        .optional()
        .describe("Custom provider configurations and model overrides"),
      mcp: z
        .record(
          z.string(),
          z.union([
            Mcp,
            z
              .object({
                enabled: z.boolean(),
              })
              .strict(),
          ]),
        )
        .optional()
        .describe("MCP (Model Context Protocol) server configurations"),
      formatter: z
        .union([
          z.literal(false),
          z.record(
            z.string(),
            z.object({
              disabled: z.boolean().optional(),
              command: z.array(z.string()).optional(),
              environment: z.record(z.string(), z.string()).optional(),
              extensions: z.array(z.string()).optional(),
            }),
          ),
        ])
        .optional(),
      adaptive_routing: z
        .object({
          mode: z.enum(["off", "ask", "auto"]).optional().default("ask"),
          thinking: z
            .object({ mode: z.enum(["off", "ask", "auto"]).optional().default("ask") })
            .optional()
            .default({ mode: "ask" }),
          base_models: z.array(z.string()).optional().default([]),
          expert_models: z.array(z.string()).optional().default([]),
          max_expert_episodes: z.number().int().min(0).optional().default(2),
          max_expert_calls: z.number().int().min(0).optional().default(3),
          max_expert_steps: z.number().int().min(0).optional().default(3),
          cooldown_steps: z.number().int().min(0).optional().default(3),
          proposal_ttl_ms: z.number().int().positive().optional().default(120_000),
          return_to_base: z.boolean().optional().default(true),
        })
        .optional()
        .describe("User policy for model and thinking-level proposals; auto mode still requires a trusted grant"),
      lsp: z
        .union([
          z.literal(false),
          z.record(
            z.string(),
            z.union([
              z.object({
                disabled: z.literal(true),
              }),
              z.object({
                command: z.array(z.string()),
                extensions: z.array(z.string()).optional(),
                disabled: z.boolean().optional(),
                env: z.record(z.string(), z.string()).optional(),
                initialization: z.record(z.string(), z.any()).optional(),
              }),
            ]),
          ),
        ])
        .optional()
        .refine(
          (data) => {
            if (!data) return true
            if (typeof data === "boolean") return true
            const serverIds = new Set(Object.values(LSPServer).map((s) => s.id))

            return Object.entries(data).every(([id, config]) => {
              if (config.disabled) return true
              if (serverIds.has(id)) return true
              return "extensions" in config ? Boolean((config as any).extensions) : false
            })
          },
          {
            error: "For custom LSP servers, 'extensions' array is required.",
          },
        ),
      instructions: z.array(z.string()).optional().describe("Additional instruction files or patterns to include"),
      layout: Layout.optional().describe("@deprecated Always uses stretch layout."),
      permission: Permission.optional(),
      tools: z.record(z.string(), z.boolean()).optional(),
      enterprise: z
        .object({
          url: z.string().optional().describe("Enterprise URL"),
        })
        .optional(),
      compaction: z
        .object({
          auto: z.boolean().optional().describe("Enable automatic compaction when context is full (default: true)"),
          prune: z.boolean().optional().describe("Enable pruning of old tool outputs (default: true)"),
        })
        .optional(),
      experimental: z
        .object({
          hook: z
            .object({
              file_edited: z
                .record(
                  z.string(),
                  z
                    .object({
                      command: z.string().array(),
                      environment: z.record(z.string(), z.string()).optional(),
                    })
                    .array(),
                )
                .optional(),
              session_completed: z
                .object({
                  command: z.string().array(),
                  environment: z.record(z.string(), z.string()).optional(),
                })
                .array()
                .optional(),
            })
            .optional(),
          chatMaxRetries: z.number().optional().describe("Number of retries for chat completions on failure"),
          disable_paste_summary: z.boolean().optional(),
          batch_tool: z
            .boolean()
            .optional()
            .describe("Deprecated compatibility option; batch is always registered and this value is ignored"),
          openTelemetry: z
            .boolean()
            .optional()
            .describe("Enable OpenTelemetry spans for AI SDK calls (using the 'experimental_telemetry' flag)"),
          primary_tools: z
            .array(z.string())
            .optional()
            .describe("Tools that should only be available to primary agents."),
          continue_loop_on_deny: z.boolean().optional().describe("Continue the agent loop when a tool call is denied"),
          execution_classification: z
            .boolean()
            .optional()
            .describe(
              "Enable model-based semantic execution classification; enabled by default unless explicitly false",
            ),
          scope_escalation: z
            .object({
              mode: z.enum(["off", "ask", "auto"]).optional().default("ask"),
              max_per_session: z.number().int().positive().optional().default(20),
              cooldown_ms: z.number().int().nonnegative().optional().default(0),
            })
            .optional()
            .describe("Runtime scope escalation policy; ask supports one-time and always approval through permissions"),
          smart_model_routing: z
            .boolean()
            .optional()
            .describe("Enable automatic model selection per task category in orchestrate tool"),
          auto_mode: z
            .enum(["speed", "balanced", "quality", "reasoning"])
            .optional()
            .describe("Routing mode for automatic model selection"),
          auto_router: RouterPreferences.optional().describe("AtomCLI Auto routing preferences"),
          free_router: RouterPreferences.omit({
            allowed_providers: true,
            allow_paid_models: true,
            allow_paid_probes: true,
          })
            .optional()
            .describe("Independent AtomCLI Free preferences; only explicitly free atomcli models are eligible"),
          mcp_timeout: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Timeout in milliseconds for model context protocol (MCP) requests"),
        })
        .optional(),
    })
    .strict()
    .meta({
      ref: "Config",
    })

  export type Info = z.output<typeof Info>
}
