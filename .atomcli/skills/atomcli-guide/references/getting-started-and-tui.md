# Getting started and TUI

## Install

Linux and macOS release installer:

```sh
curl -fsSL https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.sh | bash
```

Windows PowerShell installer:

```powershell
irm https://raw.githubusercontent.com/aToom13/AtomCLI/main/install.ps1 | iex
```

The installers automatically scan required commands and browser libraries, install missing dependencies with the available platform package manager, synchronize release-matched Playwright and Chromium, and perform a real browser launch check. Linux package installation may request `sudo`.

Verify the installed command:

```sh
atomcli --version
atomcli --help
```

To build from source, use the Bun version pinned by the repository. Primary development commands run from `AtomBase/`:

```sh
git clone https://github.com/aToom13/AtomCLI.git
cd AtomCLI
bun install --frozen-lockfile
cd AtomBase
bun run build
```

For a local development run from `AtomBase/`, use the browser condition required by the TUI:

```sh
bun run --conditions=browser ./src/index.ts
```

## First use

Connect a provider, inspect models, and open the interactive interface:

```sh
atomcli auth login
atomcli auth list
atomcli models
atomcli
```

Start AtomCLI from the project directory it should understand. Project-local configuration, agents, skills, and commands are discovered relative to that directory and its worktree.

Select a model at startup with the canonical `provider/model` form:

```sh
atomcli -m openai/gpt-5.1
```

Confirm the exact local model ID with `atomcli models <provider>` rather than guessing it.

## Interactive TUI

Type a prompt and press Enter to submit it. Insert a newline with Shift+Enter, Ctrl+Enter, Alt+Enter, or Ctrl+J on supported terminals. Use `/help` to see command families and current keybindings.

Ctrl+C opens the exit confirmation with Cancel selected by default. Move between Cancel and Confirm with the arrow keys or H/J/K/L, press Enter to choose, or press Escape to stay in AtomCLI.

Normal prompts, slash commands, and shell submissions use the same delivery indicator. `FAILED` means the server rejected the request; `DELIVERY UNKNOWN` means the connection ended before an acknowledgement, so the operation may already have started and is never resent automatically. Focus the message and press Enter to restore its draft, inspect current session state, and retry only when safe.

Normal TUI startup uses its in-process transport and does not reserve a loopback control-plane port. This leaves the preferred `4096` port available to the automatically started Companion listener. A control-plane listener starts only when network options such as `--port`, `--hostname`, or `--mdns` request it.

Shell submissions publish live output in 50 ms batches and retain at most the newest 2 MiB. A visible truncation marker replaces discarded earlier output, preventing long-running commands from growing the session without bound while preserving their latest diagnostics.

Primary slash-command families:

| Command     | Purpose                                                                |
| ----------- | ---------------------------------------------------------------------- |
| `/session`  | Switch, create, compact, rename, inspect, export, or share sessions    |
| `/model`    | Select a model and configure thinking or routing                       |
| `/agent`    | Select an agent or inspect skills                                      |
| `/settings` | Provider status, MCP, theme, and approval mode                         |
| `/workflow` | Review, security, refactor, docs, performance, tests, and PR workflows |
| `/help`     | Show command families and keyboard help                                |

Useful examples:

```text
/model select
/model think high
/model visibility
/model smart
/adaptive-routing ask
/agent select
/agent skills
/settings status
/settings auth
/settings mcp
/settings approvals autonomous
/settings approvals safe
/session new
/session list
/session compact
/workflow review
/workflow tests authentication
```

Legacy shortcuts such as `/models`, `/agents`, `/skills`, `/status`, `/auth`, `/mcp`, `/theme`, `/thinking`, and `/sessions` remain accepted. Prefer the grouped forms when teaching new users because they are easier to discover with autocomplete.

Adaptive routing modes are `off`, `ask`, and `auto`. `off` is the immediate stop control; `ask` opens a proposal decision; `auto` can reuse only a previously accepted exact execution-scoped grant. Active model, thinking level, base/expert stage, pin, and call budget remain visible above the prompt.

The default leader key is Ctrl+X. Common defaults include:

| Key                 | Action                       |
| ------------------- | ---------------------------- |
| `Ctrl+P`            | Open command list            |
| `Ctrl+X`, then `M`  | Open model list              |
| `Ctrl+X`, then `A`  | Open agent list              |
| `Ctrl+X`, then `N`  | New session                  |
| `Ctrl+X`, then `L`  | Session list                 |
| `Escape`            | Interrupt the active session |
| `Tab` / `Shift+Tab` | Cycle agents                 |
| `Ctrl+T`            | Cycle model variants         |

Keybindings are configurable and may differ. `/help` reflects the active configuration.

## Non-interactive use

Run a single prompt:

```sh
atomcli run "Explain the architecture of this project"
atomcli run -m provider/model "Fix the failing tests"
atomcli run --agent build "Implement the requested endpoint"
```

Useful `run` options:

```sh
atomcli run -f screenshot.png "Explain this error"
atomcli run -c "Continue the latest session"
atomcli run -s <session-id> "Continue this session"
atomcli run --format json "Inspect this project"
atomcli run --variant high "Solve this carefully"
```

- `-f`/`--file` may be repeated to attach files.
- `-c` continues the latest session; `-s` selects an explicit session.
- `--format json` emits raw JSON events for automation.
- `--variant` selects a provider-specific model variant or reasoning effort.
- Run `atomcli run --help` for the exact options in the installed version.

## Shell completion

The installer normally configures completion. Manual activation:

```sh
# Bash
source <(atomcli completion bash)

# Zsh
source <(atomcli completion zsh)

# Fish
atomcli completion fish | source
```

PowerShell:

```powershell
atomcli completion powershell | Out-String | Invoke-Expression
```
