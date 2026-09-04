# Skills Guide

Skills are Markdown instruction packages discovered from files named exactly `SKILL.md`. They add domain-specific workflows without placing every instruction into every prompt. A skill declares a unique `name`, a discriminating `description`, and optionally `trigger_words` in YAML frontmatter.

## Discover and manage skills

```sh
atomcli skill list
atomcli skill show <name>
atomcli skill add <github-url-or-repository-path>
atomcli skill remove <name>
```

Run these commands from the project whose local skills you want to inspect. `skill add` installs external content and `skill remove` deletes an installed skill, so review the source and target before approving either operation.

Skills are discovered from these scopes:

| Scope   | Location                              | Notes                               |
| ------- | ------------------------------------- | ----------------------------------- |
| Project | `.atomcli/skills/**/SKILL.md`         | Primary project location            |
| Project | `.atomcli/skill/**/SKILL.md`          | Singular variant, also scanned      |
| Project | `.claude/skills/**/SKILL.md`          | Compatibility location              |
| Global  | `~/.atomcli/skills/**/SKILL.md`       | Available across projects           |
| Global  | `~/.claude/skills/**/SKILL.md`        | Global compatibility location       |
| Bundled | Installation `.atomcli/` / `.claude/` | Tracked assets shipped with AtomCLI |

Project discovery walks the active project directories up to its worktree boundary. Skill names must be unique across every discovered scope. Duplicate names log a warning and a later scan result can replace an earlier definition; never depend on that order for intentional overrides.

## How activation works

AtomCLI uses progressive disclosure:

1. Discovery reads frontmatter and makes each allowed skill's name and description available to the agent.
2. If the user's text contains a `trigger_words` entry, case-insensitively, AtomCLI surfaces that skill in a lightweight suggestion block. At most three candidates are surfaced.
3. A suggestion does not inject or activate the skill. The agent reads the description, decides whether it is semantically relevant, and loads it through the `skill` tool.
4. Loading returns the `SKILL.md` body and the skill's base directory. Relative reference links can then be read as needed.

Descriptions are the main activation contract. Write what the skill helps with and what should not activate it. Keep trigger words narrow enough to improve discovery; a common word can produce many false suggestions even though the agent still makes the final decision.

Agent permission rules can deny individual skills. A discovered skill that is denied for the active agent is not offered through that agent's tool description.

## Author a skill

Create a directory whose entrypoint is `SKILL.md`:

```text
.atomcli/skills/my-skill/
├── SKILL.md
├── references/
│   ├── configuration.md
│   └── troubleshooting.md
└── scripts/
    └── verify.ts
```

Only add supporting directories that the workflow genuinely needs. A minimal entrypoint looks like:

```md
---
name: my-skill
description: Configure and troubleshoot Example deployments. Use for Example setup, authentication, rollout, and incident questions. Do not use for unrelated application coding.
trigger_words:
  - example deployment
  - example rollout
---

# Example deployment guide

Lead with the shortest safe workflow. Do not request or expose credentials.

Read only the reference needed for the request:

- Setup or authentication: [references/configuration.md](references/configuration.md)
- Failures and recovery: [references/troubleshooting.md](references/troubleshooting.md)
```

Frontmatter fields:

| Field           | Required | Meaning                                                        |
| --------------- | -------- | -------------------------------------------------------------- |
| `name`          | Yes      | Stable identifier used by CLI, tools, and permissions          |
| `description`   | Yes      | Scope and activation boundary visible before loading           |
| `trigger_words` | No       | Case-insensitive phrases that surface the skill as a candidate |

## Authoring rules

- Keep `SKILL.md` concise: scope, decision rules, routing, safety, and verification belong there; detailed material belongs in focused references.
- Use paths relative to `SKILL.md` and link directly to each required reference. Avoid deep chains where one reference points to many more files.
- Write commands that are copyable and state their working directory, prerequisites, mutations, and expected verification.
- Prefer current source or CLI help over facts likely to drift. Avoid hard-coded model catalogs, provider counts, prices, and package versions.
- Include negative activation boundaries when the skill name or trigger words could match unrelated work.
- Never include credentials, personal configuration, machine-specific absolute paths, dependencies, logs, sessions, or generated artifacts.
- Reuse a small script or template when deterministic work would otherwise be retyped repeatedly. Explain when it is safe to run.
- Treat installation, deletion, publishing, network exposure, and external writes as state-changing operations that require clear user intent.

## Project, global, or bundled?

- Use a project skill for repository-specific workflows that should be reviewed and versioned with that project.
- Use a global skill for personal guidance needed across unrelated projects.
- Add a bundled skill only when it is useful to AtomCLI users generally and should ship in every release. Bundled content must be portable, credential-free, and intentionally tracked under the repository root `.atomcli/` or `.claude/` directory.

Runtime files under those directories remain ignored. Never force-add package manifests, lockfiles, `node_modules`, configuration, credentials, plans, runs, inbox content, logs, or session state just because the build copies tracked skill assets.

## Built-in `atomcli-guide`

AtomCLI ships `.atomcli/skills/atomcli-guide/` as its product and contributor manual. It covers installation, TUI usage, configuration, providers, extensions, server/Companion operation, troubleshooting, and source development. The entrypoint routes to focused files under `references/` so a simple question does not load the entire manual.

When changing AtomCLI behavior:

1. Update the canonical public or contributor document.
2. Update the matching `atomcli-guide` reference if the subject is covered there.
3. Keep the skill description broad enough for AtomCLI product and development questions but explicit that ordinary coding work should not activate it merely because AtomCLI is in the repository.
4. Preserve the rule that the checkout's current `AGENTS.md` overrides bundled contributor guidance.
5. Validate parsing, links, development coverage, and CLI discovery.

The focused verification is:

```sh
cd AtomBase
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json bun test test/skill/atomcli-guide.test.ts
bun run --conditions=browser ./src/index.ts skill list
bun run --conditions=browser ./src/index.ts skill show atomcli-guide
```

Use AtomCLI's own parser and test for this repository. Generic skill validators may reject the supported AtomCLI-specific `trigger_words` field.

## Troubleshoot discovery

If a skill does not appear in `atomcli skill list`, check that:

- the filename is exactly `SKILL.md`;
- YAML frontmatter parses and contains string `name` and `description` fields;
- `trigger_words`, if present, is an array of strings;
- the file is under a discovered project, global, compatibility, or bundled directory;
- the command is running from the intended project/worktree;
- another skill does not reuse the same name;
- the active agent's skill permissions do not deny it.

After adding a skill during a running session, reload it through the supported CLI/tool flow or start a new session if cached project state is still visible. Use `atomcli skill show <name>` to distinguish discovery problems from reference or instruction problems.
