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

`atomcli upgrade` remains an alias for `atomcli update`. Installer and update progress is shown with an overall progress bar plus activity spinners for long downloads. On Linux, automatic system-package installation can request `sudo`; use `ATOMCLI_SKIP_PLAYWRIGHT=1` only when browser automation is intentionally unavailable.

To build from source, use Bun 1.3.10:

```sh
git clone https://github.com/aToom13/AtomCLI.git
cd AtomCLI
bun install --frozen-lockfile
cd AtomBase
bun run build
```

Build output is written to `AtomBase/dist/` and is removed at the beginning of every build. Releases are triggered only by pushing a `v*` tag.

Native release binaries target Linux x64/ARM64 (glibc and musl), macOS x64/ARM64, and Windows x64/ARM64. Stable releases also attach a signed, checksum-covered Android Companion APK. Baseline x64 builds support older CPUs without AVX2. FreeBSD is not a release target because the Bun runtime does not provide a FreeBSD executable target; the bundled ripgrep integration can use a system `rg` on FreeBSD when embedded in a future supported runtime.

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

Start pairing from either the TUI or headless server:

```sh
atomcli --companion
atomcli serve --companion
```

The first automatic Companion listener prefers port 4096. If that port is occupied, including by another AtomCLI process, AtomCLI selects an available port and prints the real endpoint in the pairing information. A port explicitly fixed with `--companion-port` or `server.companionPort` does not move silently and fails on collision.

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
