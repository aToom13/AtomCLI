# AtomCLI

```text
  █████╗ ████████╗ ██████╗ ███╗   ███╗   ██████╗██╗     ██╗
 ██╔══██╗╚══██╔══╝██╔═══██╗████╗ ████║  ██╔════╝██║     ██║
 ███████║   ██║   ██║   ██║██╔████╔██║  ██║     ██║     ██║
 ██╔══██║   ██║   ██║   ██║██║╚██╔╝██║  ██║     ██║     ██║
 ██║  ██║   ██║   ╚██████╔╝██║ ╚═╝ ██║  ╚██████╗███████╗██║
 ╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝     ╚═╝   ╚═════╝╚══════╝╚═╝
```

AtomCLI is a Bun-based terminal AI coding assistant. It offers an interactive terminal UI, a headless HTTP server, Agent Client Protocol support, multiple model providers, MCP integration, skills, and local session data.

## Install

Release installers are available for supported platforms:

```sh
curl -fsSL https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.sh | bash
```

In PowerShell:

```powershell
irm https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.ps1 | iex
```

Both installers scan required commands and browser libraries, install missing dependencies through the platform package manager when possible, synchronize the Playwright version required by the selected AtomCLI release, and verify a real Chromium launch. The same repair path runs during updates:

```sh
atomcli update
atomcli update vX.Y.Z
atomcli setup --check
atomcli setup --yes
```

`atomcli upgrade` remains an alias for `atomcli update`. Installer and update output reports setup-stage progress, the Unix installer shows download progress in interactive terminals, and Bun and Playwright work keeps activity indicators visible. On Linux, automatic system-package installation can request `sudo`; Alpine installations use the matching musl binary and require `libstdc++` and `libgcc`, which the installer adds when missing. Use `ATOMCLI_SKIP_PLAYWRIGHT=1` only when browser automation is intentionally unavailable.

To build from source, use Bun 1.3.14:

```sh
git clone https://github.com/aToom13/AtomCLI.git
cd AtomCLI
bun install --frozen-lockfile
cd AtomBase
bun run build
```

Build output is written to `AtomBase/dist/` and is removed at the beginning of every build. Releases are triggered only by pushing a `v*` tag.

Native release binaries target Linux x64/ARM64 (glibc and musl), macOS x64/ARM64, and Windows x64/ARM64. Stable releases also attach a signed, checksum-covered Android Companion APK. Installers retry transient downloads and select baseline x64 builds on processors without AVX2; set `ATOMCLI_BASELINE=1` to force this selection. The Windows installer supports Windows PowerShell 5.1 without treating native command stderr as installation failure. FreeBSD is not a release target because the Bun runtime does not provide a FreeBSD executable target; the bundled ripgrep integration can use a system `rg` on FreeBSD when embedded in a future supported runtime.

## Start

```sh
atomcli
atomcli --help
atomcli auth login
atomcli models
atomcli -m provider/model
atomcli run "Explain this project"
```

Run `atomcli <command> --help` for the current options. The complete top-level command list is defined in `AtomBase/src/index.ts`.

Inside the interactive TUI, use `/model` or `/models` to open the model picker. The picker supports search by model name, ID, provider, and capability; it also exposes favorites and free/reasoning filters. OAuth-backed ChatGPT/Codex models are marked as subscription models rather than free models.

The session transcript follows live output only while the viewport is at the tail. Manual upward scrolling preserves the visible message and line while tokens, tool results, taskflow events, or terminal resizes change transcript height; returning to the bottom resumes follow-tail. `PageUp`/`PageDown`, `Home`/`End`, and the configured first/last-message bindings remain available for long sessions.

Pressing Ctrl+C opens a safe exit confirmation with **Cancel** selected by default. Use the arrow keys or H/J/K/L to move between Cancel and Confirm, then press Enter; Escape cancels the dialog.

Prompt, slash-command, and shell submissions show a delivery state. A server rejection is marked **FAILED**; a connection loss before acknowledgement is marked **DELIVERY UNKNOWN** so AtomCLI does not silently resend a command that may already have run. Focus that message and press Enter to restore its draft for inspection or retry.

Interactive shell output is published to the session in 50 ms batches and keeps at most the newest 2 MiB. When older output is removed, the stored result starts with an explicit truncation marker; command completion and the newest diagnostics remain visible without unbounded session growth.

Use `/model think` to select a reasoning level. The menu is derived from the active model, so unsupported levels are not offered. `/model visibility` only controls whether reasoning output is shown; it does not change the model's reasoning level.

Useful commands include:

```sh
atomcli auth list
atomcli agent list
atomcli session list
atomcli skill list
atomcli mcp list
atomcli serve
atomcli acp
atomcli stats
atomcli review --help
```

## Built-in AtomCLI guide

Release builds include the `atomcli-guide` skill. It covers everyday CLI use, configuration, providers, extensions, server and Companion workflows, troubleshooting, and source development. Ask a natural-language question such as “How do I add a skill in AtomCLI?” or “How should I test an AtomCLI server change?” and the agent can load the relevant part of the guide.

Inspect the installed guide directly with:

```sh
atomcli skill show atomcli-guide
```

The guide uses focused reference files instead of placing the entire manual in every prompt. Its trigger words only surface it as a candidate; the active agent still decides whether the request is actually about AtomCLI. In a source checkout, the nearest `AGENTS.md` remains authoritative for contributor rules.

## Android Companion

> **Beta:** AtomCLI Companion is still under active development. Android builds are usable for testing and daily development workflows, but mobile behavior, protocol capabilities, background execution, and UI details may change between releases. Treat it as a companion control surface rather than the sole copy of important work.

Normal `atomcli` TUI startup keeps a scoped Companion listener ready in the worker and uses an in-process transport for the local TUI. It does not create a pairing token or authorize a new phone. Start an explicit pairing flow from either the TUI or headless server:

```sh
atomcli --companion
atomcli serve --companion
```

The Companion listener gets first use of port 4096 during normal TUI startup, preserving saved phone endpoints. Explicit control-plane options such as `--port`, `--hostname`, or `--mdns` also start the HTTP control API; a port conflict can then move an automatically assigned Companion listener. The TUI footer shows the actual ports. A second AtomCLI process independently falls back to an available port. Use `--no-companion` to disable the listener. A port explicitly fixed with `--companion-port` or `server.companionPort` does not move silently and reports a visible partial-start error on collision.

Paired device credentials are global, so later AtomCLI processes can enable their own Companion listener without showing a new QR code. Each process still owns a separate endpoint and session context; the phone connects to the selected machine endpoint, not to every running process at once. See the [Companion guide](companion/README.md).

## Reliability and code review

AtomCLI guards file edits with content hashes and optional line anchors, so a stale agent action cannot silently overwrite a file that changed after it was read. Multi-operation edits are applied atomically.

During an active long-running taskflow, AtomCLI injects a bounded progress checkpoint after every five tool calls or five minutes on the next model turn. The checkpoint lists recorded step states and reminds the agent to reconcile stale progress without automatically claiming that work completed.

The LSP tool supports diagnostics, definitions, references, workspace symbols, formatting, code actions, symbol rename, and file rename. Mutating language-server operations validate every affected file and roll back the workspace edit if an apply step fails.

Subagents can return schema-validated results and run in isolated Git worktrees. Their lifecycle and tool activity are surfaced in the TUI while the parent session retains bounded cleanup and permission controls.

Use the structured review command for a GitHub pull request or GitLab merge request:

```sh
atomcli review --provider github --repo owner/repository --pr 123 --diff-only
atomcli review --provider gitlab --repo group/project --pr 123 --reviewers 4 --output review.json --diff-only
```

The review pipeline validates findings against real changed files and line ranges, deduplicates overlapping findings, and reports P0 through P3 severity with confidence. See the [Review V2 guide](docs/REVIEW.md).

## Tab completion

The installer enables command and option completion automatically for Bash, Zsh, Fish, and PowerShell. To enable it manually for the current shell:

```sh
# Bash
source <(atomcli completion bash)

# Zsh
source <(atomcli completion zsh)

# Fish
atomcli completion fish | source
```

For PowerShell:

```powershell
atomcli completion powershell | Out-String | Invoke-Expression
```

## Configuration and data

Global AtomCLI files live under `~/.atomcli/`. The configuration loader reads global `config.json`, `atomcli.json`, `atomcli.jsonc`, and `mcp.json`. A file specified by `ATOMCLI_CONFIG` overrides global configuration; project `atomcli.jsonc`, `atomcli.json`, and `mcp.json` override it. `ATOMCLI_CONFIG_CONTENT` has the highest precedence.

Long-running work can use an optional `execution_budget` block to share call, agent-step, duration, and USD limits across a root request and its child agents. `max_cost_usd`, `session_max_cost_usd`, and `project_max_cost_usd` are separate execution, root-session-tree, and project ceilings; all configured scopes must admit a call. Model verification, retries, fallback, review, compaction, and session-bound memory calls consume the same ledger. Monetary limits reject models without known pricing by default; set `unknown_price` to `"allow"` only when accepting unmetered cost uncertainty. Completed calls may exceed their reservation, so the limit prevents later dispatches but is not an absolute billing guarantee.

A later prompt may set `resumesExecutionID` to continue a terminal execution as a new auditable segment. The new segment keeps the original execution budget scope, deadline, and cumulative call, step, and cost usage; resume cannot loosen the original limits.

Each root execution also has a renewable owner lease. An expired-owner takeover increments a monotonic fence, reclaims reservations that were never dispatched, marks abandoned tool work for explicit reconciliation, and prevents the previous process from finishing or starting work; late provider usage can still close an attempt that was already dispatched. User cancellation targets the exact captured execution and fence, while ordinary loop cleanup does not cancel shared parent/child work. Ownership is checked again after permission and middleware immediately before the tool body.

Root terminal text is staged privately in the same SQLite/WAL ledger. Staging moves the execution into a finalizing phase. Reviewer/checker calls require a persistent review claim bound to the concrete reviewer session; a completion marked as requiring review cannot commit without a matching persisted `passed` verdict for its digest and mutation revision. Commit also requires the current fenced owner and no unresolved work, then closes the execution to new work. A committed candidate is projected idempotently into session storage after restart.

Use `atomcli auth login` for credentials. Provider overrides use the `provider` field, and model identifiers use `provider/model`. See the [provider guide](docs/PROVIDERS.md) for examples.

## Documentation

- [Development guide](docs/DEVELOPMENT.md)
- [Provider and model guide](docs/PROVIDERS.md)
- [MCP guide](docs/MCP-GUIDE.md)
- [Skills guide](docs/SKILLS-GUIDE.md)
- [Android Companion guide](companion/README.md)
- [Review V2 guide](docs/REVIEW.md)
- [Prompt architecture](docs/prompts.md)
- [Documentation index](docs/README.md)
- [SDK guide](libs/sdk/README.md)

## Development

Primary application development happens in `AtomBase/`:

```sh
cd AtomBase
bun run dev
bun run typecheck
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json bun test
```

The agent-quality benchmark is separate from the deterministic unit test suite. Reporting stored observations is read-only:

```sh
bun run dev -- eval benchmark
```

Passing `--execute` runs all cases against the current Git workspace and can take substantially longer. Each case materializes its own fixture, runs under a per-case watchdog, and is graded by an independent verifier whose sources are kept out of the workspace while the agent works. On an interactive terminal you pick provider, model, and agent from menus; pass `--model provider/model` to select them explicitly. See [the benchmark guide](AtomBase/evals/README.md).

From the repository root, validate all workspace packages with `bun turbo typecheck` and `bun turbo test`.

Repository-local configuration, credentials, dependencies, plans, runs, logs, and session data are intentionally ignored. Only tracked skills and agents under `.atomcli/` and `.claude/` are release assets. See the [development guide](docs/DEVELOPMENT.md) for the pre-release hygiene checklist.

## License

AtomCLI is released under the [MIT License](LICENSE).
