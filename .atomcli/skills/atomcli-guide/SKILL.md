---
name: atomcli-guide
description: Answer questions about installing, using, configuring, extending, troubleshooting, and developing AtomCLI. Use when someone asks how to accomplish something with the AtomCLI product or how to contribute to its CLI, server, TUI, SDK, companion app, tests, builds, or releases. Do not activate for an ordinary coding task merely because its repository happens to use AtomCLI.
trigger_words:
  - atomcli
  - atom cli
---

# AtomCLI guide

Help the user accomplish a concrete task with AtomCLI. Answer in the user's language and lead with the shortest working path.

## Response rules

1. Identify whether the user is operating an installed release, running from source, using the interactive TUI, or using a non-interactive command. Do not mix instructions for these environments without labeling them.
2. Give copyable commands and name the directory or config file they affect. Use `provider/model` for model identifiers.
3. Treat `atomcli --help` and `atomcli <command> --help` from the user's installed version as the final authority when flags may differ by release.
4. Never assume a provider or model is available. Use `atomcli auth list`, `atomcli models`, or `atomcli models <provider>` to inspect the local installation.
5. Do not ask the user to paste secrets into chat or commit them. Prefer `atomcli auth login`, environment variables, or `{file:PATH}` configuration substitution.
6. For explanation-only questions, do not modify configuration or install anything. If the user requests a change, inspect the effective scope and preserve unrelated settings.
7. Distinguish project-local files under `.atomcli/` from global files under `~/.atomcli/`.
8. If a request is ambiguous, provide the common case first and mention the one decision that changes the instructions.
9. For AtomCLI source-development work, read the repository's current `AGENTS.md` before acting. Treat it as authoritative when it differs from this bundled guide.

## Route to the relevant reference

Read only the references needed for the current question:

- Installation, first run, interactive TUI, slash commands, prompt files, one-shot use, or shell completion: [references/getting-started-and-tui.md](references/getting-started-and-tui.md)
- Config locations, precedence, JSON/JSONC fields, environment/file substitution, permissions, or execution isolation: [references/configuration.md](references/configuration.md)
- Authentication, providers, model selection, reasoning levels, smart routing, fallback models, pricing labels, or Ollama: [references/providers-and-models.md](references/providers-and-models.md)
- Custom agents, skills, custom commands, MCP servers, their scopes, or extension troubleshooting: [references/extensions.md](references/extensions.md)
- Headless server, attach mode, ACP, networking, CORS/auth, mDNS, or Android companion pairing: [references/server-and-companion.md](references/server-and-companion.md)
- Sessions, taskflow progress checkpoints, import/export/share, memory, updates, logs, diagnostics, common errors, or uninstall: [references/operations-and-troubleshooting.md](references/operations-and-troubleshooting.md)
- Contributing, repository structure, coding conventions, tests, SDK generation, builds, companion development, Git hygiene, or releases: [references/development-and-contributing.md](references/development-and-contributing.md)

For a broad request such as “teach me AtomCLI,” read the getting-started reference first, then ask which workflow the user wants to explore. Do not dump every reference into one answer.

## Verification

When practical, end with one read-only check that proves the result, such as:

```sh
atomcli skill list
atomcli agent list
atomcli auth list
atomcli models <provider>
atomcli mcp list
atomcli session list
```

If the command would change external state, install software, expose a network listener, or remove data, explain that effect before suggesting execution.
