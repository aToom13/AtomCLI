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
- Configured `autonomous` mode applies only to its project. Process-level YOLO flags apply across projects. Explicit external-directory denials remain enforced in either mode.
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

## Execution budgets

An optional execution budget applies to one explicit root user turn and every child-agent request it starts:

```jsonc
{
  "execution_budget": {
    "max_calls": 30,
    "max_steps": 20,
    "max_duration_ms": 900000,
    "session_max_cost_usd": 2,
    "project_max_cost_usd": 20,
    "unknown_price": "block",
  },
}
```

`max_cost_usd` limits one execution, `session_max_cost_usd` limits the persistent root-session tree across executions, and `project_max_cost_usd` limits the project total. When several are configured, every scope must admit the call. Calls made for verification, retry/fallback, review, compaction, and session-bound memory count alongside the main model. Limits and reservations persist across process restarts. With a monetary limit, unknown model pricing is blocked by default; `"allow"` accepts that uncertainty. Actual provider usage can exceed its estimate, so AtomCLI records the full cost and blocks later dispatches but cannot promise a hard billing ceiling for an already-running request.

The ledger assigns each root execution a renewable owner lease. If another process takes over after expiry, the fence increases, reservations that were never dispatched are reclaimed, and the stale process cannot start tools or dispatch more work. Cancellation is persisted and checked again before tool side effects. Root final text is kept private in a bounded persistent candidate; staging admits only reviewer/checker model work, and commit requires the current owner plus the current tracked workspace-mutation revision before closing the execution to new work. Committed text can be projected safely after a restart. Taskflow, workflow, child, and verification obligations are durable blockers; only resolved or explicitly authorized and reasoned waivers satisfy the success gate.

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

## Adaptive execution and classification

Adaptive execution pipelines (`direct`, `focused`, `coordinated`) use the deterministic local `TaskProfile`, shared with model routing. Classification adds no model call. Disable local profiling only when conservative defaults are desired:

```jsonc
{
  "experimental": {
    "execution_classification": false,
  },
}
```

Execution contracts use these pipelines:

- `direct`: Single goal, max 2 steps, max 3 tool calls, restricted tools, no subagents or expert routing.
- `focused`: Targeted fix, max 6 steps, max 10 tool calls, targeted tools, expert routing only on failure.
- `coordinated`: Multi-subsystem work, initially 30 steps and 30 tool calls, full tool set, taskflow allowed. At 80% consumption, tool-free checkpoint requests may grant up to 50 more tool calls per slice. Runtime stops new work after twenty extensions, or earlier when repeated calls, targets, errors, or consecutive no-progress slices indicate a loop, then uses a separate tool-free finalization phase to return the result and blocker status.

An empty tool allowlist means the scope states no tool preference; it never means no tools are advertised. A turn is only treated as conversational when it is a short question or greeting that names no work surface, so continuations such as "devam et" keep the full toolset. A chat turn still collapses to `model_control` alone. If a turn receives no tools, the agent is instructed to say so rather than guess.

Classification uses the shared local TaskProfile without model calls or classifier cost. Scope and risk promote dynamically based on observable runtime evidence. Checkpoint `continue` grants extend the adaptive work slice in the same durable transaction, but explicit `max_calls`/`max_steps` remain hard admission ceilings. Slice growth stays bounded by the twenty-grant extension ceiling and 50-call slice clamps. Cost ceilings and the duration deadline are never raised by adaptive policy.

Each checkpoint also requires a structured self-critique: `routeDecision` (`keep` or `revise`), `selfCritique`, `failedApproaches`, and `whatToChanges`. A `revise` verdict or any recorded failed approach steers the next work slice through a route-guidance block instead of merely being stored, and four consecutive `revise` verdicts without progress are treated as a stall.

When `execution_classification` is explicitly `false`, AtomCLI uses conservative defaults: normal agent/build/plan/explore work is focused, reviewer work is direct. Runtime evidence may promote scope and risk. Adaptive limits, checkpoints, watchdogs, and finalization remain active.

Scope may be raised during an active execution with the `scope_control` tool. Only the main conversation may escalate or reset; child agents may inspect status but cannot change the root execution scope. Reset clears the session floor for future turns, not the active execution's scope. `experimental.scope_escalation.mode` accepts `ask` (default), `auto`, or `off`; `max_per_session` bounds repeated escalation. `cooldown_ms` defaults to 0 and may be set to add a delay. Escalation is monotonic; per-session count and configured cooldown state persist across restart. Manual model and thinking pins still override adaptive routing.
`scope_control(action="status")` reports current scope/floor, next scope's policy-level tool allowance and subagent eligibility, plus persisted escalation use and cooldown. Agent allowlists and user permissions may still narrow the actual advertised tools.

Policy-triggered review requires workspace mutation evidence. Conversation-only and read-only turns do not automatically launch reviewers. Explicit reviewer agent calls can inspect existing code without edits.

Automatic review requires `review.auto: true`. Without it, the effective policy is `advisory`; `configuredPolicy` retains the configured strategy. `off` or `enabled: false` makes the effective policy `off`. Explicit independent-review steps can still require review. Required review fails closed: timeout, cancellation, infrastructure error, or inconclusive verdict blocks completion; warnings cannot substitute for PASS. The optional block defaults to configured `adaptive`, one reviewer, three attempts. Multiple reviewers require explicit `reviewer_count` (1–4) or requested reviewer tasks. `high_risk_patterns` also applies in Companion `fast` when auto review is enabled. Policy/content conflicts retry at most three times; stale ownership never retries.

## Data retention

`retention` is optional. Defaults: `enabled: true`, `orphan_hours: 24`, `interval_hours: 24`, `max_delete_mib: 1024`, `snapshot_mib: 1024`, `snapshot_file_mib: 2`, `replay: false`. New snapshot capture stops at the shared object budget; existing rollback stays. Files above the per-file limit and runtime/dependency directories have no snapshot rollback. Each tree is limited to 64 MiB / 10,000 files; repository Git ignore rules apply. Full model/tool replay copies are opt-in; maintenance discards saved request copies when disabled, expires opt-in diagnostics after seven days, and are separate from retained chats and execution checkpoints. Replaced unreferenced blobs retire immediately; maintenance also compacts verified legacy originals and collects old orphans. Backups and live conversations are retained. Live record writes have a fixed 2 GiB admission ceiling (payload plus per-pointer overhead); growing writes fail visibly at the ceiling instead of deleting history. Binaries, backups and existing legacy data are outside this accounting. Set `enabled: false` to disable automatic maintenance. Preview with `atomcli debug storage --all-projects`; `--apply` performs cleanup. Restart older AtomCLI processes before applying. Details: `docs/DEVELOPMENT.md`, “Automatic data retention”.
