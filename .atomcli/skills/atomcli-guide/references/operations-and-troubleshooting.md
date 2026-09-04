# Operations and troubleshooting

## Sessions

List sessions:

```sh
atomcli session list
atomcli session list --max-count 20
atomcli session list --format json
```

Continue work:

```sh
atomcli run -c "Continue the latest session"
atomcli run -s <session-id> "Continue this session"
```

Export a session as JSON:

```sh
atomcli export <session-id> > session.json
```

Omit the ID for an interactive selection. Standard output is the JSON payload, so redirect it to a file.

Import a local export or supported AtomCLI share URL:

```sh
atomcli import session.json
atomcli import https://atomcli.ai/share/<slug>
```

In the TUI, `/session` exposes switching, new session, history/transcript, compact, rename, export, and sharing actions. Session sharing may expose conversation content externally; confirm the user's intent before enabling or posting a share URL.

## Memory

Inspect learned profile data:

```sh
atomcli memory show
atomcli memory profile
atomcli memory preferences
```

Manage it:

```sh
atomcli memory set-name "Ada"
atomcli memory export --output memory.json
atomcli memory clear
```

`memory clear` removes learned memory and requires confirmation unless `--yes` is used. Treat it as destructive. Session data and memory are separate concepts.

Disable session-close retrospective learning in config when desired:

```jsonc
{
  "memory": {
    "retrospective": false,
  },
}
```

## Updates

Interactive or explicit update (`upgrade` remains an alias):

```sh
atomcli update
atomcli update vX.Y.Z
atomcli update --channel beta
```

The update flow verifies release checksums, shows install progress, repairs missing prerequisites where supported, synchronizes the selected release's Playwright version, downloads its Chromium revision, and launch-checks the browser runtime. Configuration is preserved and optional first-install questions are not repeated.

Automatic update settings:

```sh
atomcli autoupdate status
atomcli autoupdate on --channel stable
atomcli autoupdate off
```

Channels are `stable`, `beta`, and `alfa`. Do not promise a version exists; the upgrade command retrieves available releases.

## Browser dependencies

Check or install Playwright browser dependencies used by browser workflows:

```sh
atomcli setup --check
atomcli setup --yes
```

The check performs a real Chromium launch matching the current desktop/headless environment rather than only checking whether files exist. The install form writes the Playwright module beneath `~/.atomcli/playwright`, where a compiled AtomCLI binary can resolve it; it also installs missing Arch/CachyOS or Fedora libraries and uses Playwright's dependency installer on Debian/Ubuntu. It downloads software and may request `sudo`, so explain this before running it.

## Long-running taskflow checkpoints

While a taskflow is active, AtomCLI gives the primary working agent a compact progress checkpoint after every five tool calls or five minutes. The five-minute threshold is checked on the next model turn and does not create background model traffic while the session is idle. If recorded step states have not changed since the previous checkpoint, the reminder asks the agent to reconcile them with `taskflow update`, `complete`, or `fail`. It never completes work automatically, and taskflow state remains isolated to its owning session.

## Status and diagnostics

Start with read-only inspection:

```sh
atomcli --version
atomcli --help
atomcli auth list
atomcli models
atomcli agent list
atomcli skill list
atomcli mcp list
atomcli session list
```

In the TUI use `/settings status` for provider and MCP status.

Print runtime logs to stderr:

```sh
atomcli --print-logs
atomcli --print-logs run "Reproduce the problem"
```

AtomCLI also reports the exact log-file path in fatal errors. Use that path rather than assuming a filename; logs normally live beneath `~/.atomcli/logs/`.

For source checkouts, distinguish installed and development binaries:

```sh
command -v atomcli
atomcli --version
cd AtomBase
bun run --conditions=browser ./src/index.ts --version
```

A source edit does not change the globally installed binary until it is rebuilt and installed or released.

## Common failure patterns

### Model not found or unavailable

1. Run `atomcli auth list`.
2. Run `atomcli models <provider>`.
3. Verify the `provider/model` ID.
4. Check project overrides before global config.
5. Use `--print-logs`.

### Config change has no effect

Check precedence in this order: `ATOMCLI_CONFIG_CONTENT`, project config, `ATOMCLI_CONFIG`, global config, remote well-known config. Also verify whether the active process needs a restart or config reload.

### Skill or agent is missing

- Confirm exact filename and directory.
- Skills require `SKILL.md` plus `name` and `description` frontmatter.
- Agents require a Markdown file with valid frontmatter.
- Run `atomcli skill list` or `atomcli agent list` from the intended project directory.
- Look for duplicate names across project, global, compatibility, and bundled scopes.

### MCP server fails

Use `atomcli mcp debug <name>`, inspect the effective `mcp.json`, verify local command availability or remote URL/OAuth settings, then retry with `--print-logs`.

### Port already in use

- Automatic control-plane and companion modes can select available ports.
- Explicit `--port`, `--companion-port`, or fixed config values may intentionally fail on collision.
- Use the URL/port printed by the process instead of assuming 4096.
- Identify and stop the conflicting process only if the user intends to stop it.

### TUI import or rendering failure in source mode

Run from `AtomBase/` with:

```sh
bun run --conditions=browser ./src/index.ts
```

Omitting `--conditions=browser` can cause SolidJS/TUI import failures.

## Uninstall

```sh
atomcli uninstall
```

Uninstalling the executable and deleting `~/.atomcli/` are different operations. Do not delete configuration, credentials, sessions, or memory unless the user explicitly requests that data removal and understands the consequence.
