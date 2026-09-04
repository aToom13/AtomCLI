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
