# Configuration

## Locations and precedence

AtomCLI reads configuration from several scopes. From highest to lowest precedence:

1. `ATOMCLI_CONFIG_CONTENT` environment content.
2. Project `atomcli.jsonc`, `atomcli.json`, or `mcp.json`.
3. The file selected by `ATOMCLI_CONFIG`.
4. Global files under `~/.atomcli/`.
5. Remote well-known configuration.

Global filenames include `config.json`, `atomcli.json`, `atomcli.jsonc`, and `mcp.json`. Prefer `atomcli.jsonc` when comments are useful. A project config affects that project; a global config affects every project unless overridden.

When diagnosing an unexpected value, inspect all higher-precedence sources before editing the global file.

## Minimal example

```jsonc
{
  "$schema": "https://atomcli.ai/config.json",
  "model": "provider/model",
  "small_model": "provider/smaller-model",
  "default_agent": "build",
  "agent_mode": "safe",
  "share": "manual",
  "autoupdate": "notify",
  "channel": "stable",
}
```

The schema is strict in many sections. Preserve existing fields and use the schema or current source definitions instead of inventing keys.

## Secret substitution

Configuration supports two placeholders:

- `{env:VARIABLE_NAME}` reads an environment variable and becomes an empty string if it is unset.
- `{file:PATH}` reads a file relative to the configuration file.

Example:

```jsonc
{
  "provider": {
    "openai": {
      "options": {
        "apiKey": "{env:OPENAI_API_KEY}",
        "baseURL": "https://api.openai.com/v1",
      },
    },
  },
}
```

Prefer `atomcli auth login`, environment variables, or an ignored secret file. Do not commit credentials.

## Common settings

```jsonc
{
  "theme": "system",
  "username": "Ada",
  "model": "provider/model",
  "small_model": "provider/model",
  "default_agent": "build",
  "enabled_providers": ["openai", "ollama"],
  "disabled_providers": ["example"],
  "share": "manual",
  "snapshot": true,
  "memory": {
    "retrospective": true,
  },
  "watcher": {
    "ignore": ["node_modules/**", "dist/**"],
  },
}
```

- `enabled_providers` is an allowlist; providers not listed are ignored.
- `disabled_providers` suppresses selected automatically loaded providers.
- `share` accepts `manual`, `auto`, or `disabled`.
- `agent_mode` accepts `safe` or `autonomous`. Prefer `safe` unless the user explicitly wants reduced approval prompts.
- `channel` accepts `stable`, `beta`, or `alfa`.

## Server settings

```jsonc
{
  "server": {
    "port": 4096,
    "hostname": "127.0.0.1",
    "mdns": false,
    "cors": ["https://trusted.example"],
    "auth": "{env:ATOMCLI_SERVER_TOKEN}",
  },
}
```

- A non-loopback control-plane bind requires authentication.
- Omit `server.companionPort` to let ordinary CLI launches select the companion port automatically.
- Setting `server.companionPort` makes it an explicit fixed port; a collision then produces an error instead of silently changing the endpoint.

## Execution isolation

Model-executed commands can be constrained independently of the host process:

```jsonc
{
  "execution": {
    "sandbox": "prefer",
    "filesystem": "workspace-write",
    "network": "deny",
    "environment": "minimal",
    "processVisibility": "restricted",
    "envAllow": ["CI"],
  },
}
```

Supported values:

- `sandbox`: `off`, `prefer`, `require`
- `filesystem`: `read-only`, `workspace-write`, `full`
- `network`: `deny`, `allow`
- `environment`: `minimal`, `filtered`, `inherit`
- `processVisibility`: `restricted`, `inherit`

Use broader access only when the requested workflow requires it.

## Permissions

Permissions may be configured globally or per agent. Actions are `allow`, `ask`, and `deny`; tool-specific rules may use path or command patterns. Prefer the narrowest rule that supports the workflow.

Do not solve a permission failure by switching the entire installation to autonomous mode unless the user explicitly wants that tradeoff. Explain the blocked capability and adjust only its matching rule when possible.

## Keybindings

Keybindings live under `keybinds`. The default leader is `ctrl+x`:

```jsonc
{
  "keybinds": {
    "leader": "ctrl+x",
    "model_list": "<leader>m",
    "agent_list": "<leader>a",
    "session_new": "<leader>n",
    "input_submit": "return",
    "input_newline": "shift+return,ctrl+return,alt+return,ctrl+j",
  },
}
```

Use `none` to disable a binding. Avoid assigning the same key sequence to conflicting actions.
