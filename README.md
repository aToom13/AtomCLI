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

To build from source, use Bun 1.3.10:

```sh
git clone https://github.com/aToom13/AtomCLI.git
cd AtomCLI
bun install
cd AtomBase
bun run build
```

Build output is written to `AtomBase/dist/` and is removed at the beginning of every build. Releases are triggered only by pushing a `v*` tag.

Native release binaries target Linux x64/ARM64 (glibc and musl), macOS x64/ARM64, and Windows x64/ARM64. Baseline x64 builds support older CPUs without AVX2. FreeBSD is not a release target because the Bun runtime does not provide a FreeBSD executable target; the bundled ripgrep integration can use a system `rg` on FreeBSD when embedded in a future supported runtime.

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
```

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
- [Prompt architecture](docs/prompts.md)
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
