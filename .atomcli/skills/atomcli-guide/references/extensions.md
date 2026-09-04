# Agents, skills, commands, and MCP

## Scope rules

Use project-local extensions when they belong to a repository workflow and global extensions when they should be available everywhere.

| Extension | Project                       | Global                                 |
| --------- | ----------------------------- | -------------------------------------- |
| Agent     | `.atomcli/agent/*.md`         | `~/.atomcli/agent/*.md`                |
| Skill     | `.atomcli/skills/**/SKILL.md` | `~/.atomcli/skills/**/SKILL.md`        |
| Command   | `.atomcli/command/**/*.md`    | `~/.atomcli/command/**/*.md`           |
| MCP       | `mcp.json` or config `mcp`    | `~/.atomcli/mcp.json` or global config |

Claude-compatible `.claude/skills/` locations are also discovered as fallbacks. Prefer `.atomcli/` for new AtomCLI-native assets.

## Agents

List or create agents:

```sh
atomcli agent list
atomcli agent create
atomcli agent create --help
```

`agent create` can select project/global scope, description, model, tools, and mode. Modes are:

- `primary`: selectable as the main agent.
- `subagent`: callable by another agent.
- `all`: usable in either role.

For scripted creation, provide `--path`, `--description`, `--mode`, optional `--model provider/model`, and `--tools` as required by the installed version. The generator refuses to overwrite an existing agent file.

Manual agent files are Markdown with YAML frontmatter. The body is the agent prompt:

```md
---
description: Review database migrations for safety and rollback risks.
mode: subagent
model: provider/model
permission:
  edit: deny
  bash: ask
---

Review migrations, verify findings against the repository, and report actionable risks.
```

User-defined agents extend or override native agents by name; they do not remove unrelated native agents. Keep permissions least-privileged and avoid embedding credentials.

## Skills

Manage discovered skills:

```sh
atomcli skill list
atomcli skill show <name>
atomcli skill add <github-url-or-repository-path>
atomcli skill remove <name>
```

A skill folder requires `SKILL.md` with `name` and `description`. Optional `trigger_words` surface it as a candidate when the user message contains a matching phrase, case-insensitively:

```md
---
name: release-check
description: Verify release readiness when asked to prepare or audit a release.
trigger_words:
  - release audit
  - release readiness
---

# Release check

State the project-specific workflow and verification rules.
```

The agent always sees allowed skill names and descriptions. A trigger-word match adds a lightweight suggestion; it does not inject the full skill or prove that the skill applies. The agent compares the request with the description and loads the entrypoint only when relevant.

Skill names must be unique. A duplicate logs a warning and one definition wins; never rely on scan order. Keep `SKILL.md` focused on scope, routing, safety, and verification. Put detailed workflows in small `references/` files and link them with paths relative to `SKILL.md`.

Bundled skills are copied into release assets from the repository's tracked `.atomcli/skills/`. Runtime configuration, dependencies, credentials, logs, inbox files, and session state under `.atomcli/` must remain ignored and must not be bundled.

AtomCLI ships an `atomcli-guide` skill for product usage and source-development questions. In a source checkout, update its relevant reference together with the canonical documentation and validate it with:

```sh
cd AtomBase
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json bun test test/skill/atomcli-guide.test.ts
bun run --conditions=browser ./src/index.ts skill list
```

## Custom slash commands

Create a Markdown file beneath `.atomcli/command/`; nested folders become part of the command name. The Markdown body is the prompt template:

```md
---
description: Review the current database migration.
agent: build
model: provider/model
subtask: false
---

Review the current migration for data loss, locking, rollback safety, and deployment ordering.
```

Supported frontmatter includes `description`, `agent`, `model`, and `subtask`. Omit optional fields to inherit the active session choices. Confirm the loaded command from the TUI command list.

## MCP servers

Inspect and manage MCP connections:

```sh
atomcli mcp list
atomcli mcp add
atomcli mcp install <package>
atomcli mcp remove <name>
atomcli mcp debug <name>
atomcli mcp auth <name>
atomcli mcp logout <name>
```

Important: `mcp add` and `mcp install` collect, test, or print configuration; they do not silently persist and enable every server. Add the printed entry to the intended `mcp.json` or `mcp` config field, then verify with `atomcli mcp list`.

Local MCP example:

```json
{
  "filesystem": {
    "type": "local",
    "command": ["bunx", "@modelcontextprotocol/server-filesystem", "."],
    "environment": {},
    "enabled": true,
    "timeout": 10000
  }
}
```

Remote MCP example:

```json
{
  "example": {
    "type": "remote",
    "url": "https://example.com/mcp",
    "headers": {},
    "oauth": { "scope": "read write" },
    "enabled": true,
    "timeout": 5000
  }
}
```

Security guidance:

- Review local commands and their working-directory access before enabling them.
- Scope filesystem servers to the narrowest useful directory.
- Keep tokens and client secrets out of committed project config.
- Use `atomcli mcp debug <name>` for OAuth diagnostics and `atomcli --print-logs` for broader errors.
