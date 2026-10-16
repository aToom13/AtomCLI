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

Release and local-checkout installs copy the bundled skill tree, including references. Existing user skills remain in place. Local-checkout verification compares each bundled file against its installed copy; release installs verify the archive checksum.

| Scope   | Location                              | Notes                               |
| ------- | ------------------------------------- | ----------------------------------- |
| Project | `.atomcli/skills/**/SKILL.md`         | Primary project location            |
| Project | `.atomcli/skill/**/SKILL.md`          | Singular variant, also scanned      |
| Project | `.claude/skills/**/SKILL.md`          | Compatibility location              |
| Global  | `~/.atomcli/skills/**/SKILL.md`       | Available across projects           |
| Global  | `~/.claude/skills/**/SKILL.md`        | Global compatibility location       |
| Bundled | Installation `.atomcli/` / `.claude/` | Tracked skills shipped with AtomCLI |

Project discovery walks the active project directories up to its worktree boundary. When names collide, the first discovered skill wins: project `.claude/skills/` and `.atomcli/skills/`, then project `.atomcli/skill/`. A source checkout uses its bundled `.atomcli/skills/` tree before older global copies; installed builds use their bundled tree after global locations. Duplicate names log a warning. Session and tool listings show the chosen source and shadowed paths; the TUI skill picker also shows source location. Run `atomcli skill show <name>` from the intended project to confirm which definition loaded.

## How activation works

In the TUI, typing `@` lists available skills and agents. `/agent skills` or `/skills` opens the skill list. Selecting a skill inserts `@skill-name` into the prompt without sending it. Add your request, then press Enter to send.

The Superpowers workflows appear under `/agent`: `/agent brainstorm <topic>`, `/agent write-plan <goal>`, and `/agent execute-plan <plan>`. Select one, finish writing its argument, then press Enter. The chat shows your command; workflow instructions stay behind the scenes. Existing short forms `/brainstorm`, `/write-plan`, and `/execute-plan` still work when typed, but do not appear in the root menu.

`/exit` closes the TUI.

AtomCLI uses progressive disclosure:

1. Discovery reads frontmatter and makes each allowed skill's name, description, and source available to the agent.
2. If the user's text contains a `trigger_words` word or phrase at word boundaries, case-insensitively, AtomCLI surfaces that skill in a lightweight suggestion block. At most three candidates are surfaced. For example, `ui` does not match `requirements`.
3. A suggestion does not inject or activate the skill. The agent reads the description, decides whether it is semantically relevant, and loads it through the `skill` tool.
4. Explicit skill names, `@skill-name`, directory aliases, and reference paths resolve separately from the three suggestions. All named skills are processed; ambiguous or missing references are reported. Automatic loading respects skill permissions; content requiring approval is left for the skill tool.
5. Loading returns source, base directory, character range, a bounded body, and the reference catalog. Read the parent, then select references with `references` and `reason`; an unselected parent read does not inject reference bodies. Exact user-requested reference paths still load directly. Task terms rank selected references; ranking does not decide which instructions are required.
6. Load a reference through the same `skill` tool with `name="skill-name/references/file.md"`. A shorter `references/file.md` path works only when exactly one accessible skill contains it. Canonical root and reference permissions still apply to aliases; traversal and symlink escape are rejected.

Descriptions are the main activation contract. Write what the skill helps with and what should not activate it. Keep trigger words narrow enough to improve discovery; a common word can produce many false suggestions even though the agent still makes the final decision.

Agent permission rules can deny individual skills. A discovered skill that is denied for the active agent is not offered through that agent's tool description.


## Skill trees and routing

Only an explicit whole-tree instruction such as “read all references” or “load the skill tree” requests the entire catalog. Advice to select/read necessary references uses the parent's bounded selection. An explicit `skill-name/references/file.md` requests that file; it does not require every reference from that skill or its dependencies. Ordinary phrases such as “reading list” do not request reference loading.

Optional frontmatter `dependencies: [{ name: frontend-design, when: [web, browser, html] }]` declares mandatory related skills for matching tasks. Resolution is bounded, dependency-first, and rejects missing names or cycles. The existing mutation gate checks dependency parents and selected references before editing. Explicit automatic loading resolves these dependencies before the parent. Hash-confirmed reference chunks are reused or resumed rather than injected twice; changed source reloads. Within one reference-loading result, identical complete sections are shown once with a source attribution when this shortens output. Unique or changed text, fenced examples and partial chunks stay intact; original hashes, ranges and read budgets are unchanged.

An execution classified as a mutating 3D game task routes the available `game-development` skill and its dependencies before mutation, even without a skill name in the prompt. The loader injects parent instructions first; the agent selects required references from those parents. Unselected keyword-ranked references are not automatically injected. Ordinary trigger suggestions remain advisory; inspection-only tasks do not activate this required route.

While required reads or reference selection remain pending, ordinary work turns advertise inspection, skill loading, and control tools. Implementation tools become available once the same pending-read check passes. This avoids generating a large source payload only to reject it at admission; the admission check still protects mutations and completion.

Keep `SKILL.md` as a short router and put operational detail in `references/`. Load only references needed for the current task. Follow explicit related-skill links when the task crosses domains: frontend game UI → `frontend-design` then `game-development`; media report → `media-analysis` then `Document Suite`; slide visual design → `presentation-design` with `Document Suite` for PPTX conversion. Do not load every child reference by default.

Frontend experience review inspects actual desktop/narrow screenshots, separately from behavior assertions. Composition follows the user's primary task, including populated/long-content states. The game 3D reference covers handwritten mesh integrity and using the renderer's actual transforms for observable evidence. These extend existing review steps; they add no aesthetic completion gate or mandatory reviewer chain.

## Partial loads and context

Root and reference reads are capped at 12,000 characters and 500 lines per chunk. Automatic reference loading has an aggregate 12,000-character/500-line limit per skill; automatic context has a 48,000-character content budget across skills. Explicit requests are resolved even beyond this budget. They are not silently dropped: partial ranges, exact deferred paths, offsets, and load errors are listed. Read subsequent chunks with:

```text
skill(action="load", name="game-development/references/3d-rendering.md", offset=12000, limit=12000)
```

Use the reported next offset, which can be smaller than 12,000 when the line cap applies. A request for a reference tree ranks relevant files first and reports the rest. Ordinary trigger suggestions remain advisory. The root's `task` parameter supplies dependency and ranking context; reference bodies load after explicit selection or an exact user-requested path. An omitted-content manifest describes that block; earlier confirmed reads can satisfy its offsets. Do not claim a full tree was read from its catalog.

Active executions block file-changing `write`, `edit`, and Bash calls, and block successful completion, while explicitly requested skills/references or references selected by a loaded parent remain unread. The guard merges confirmed character ranges from automatic loads and completed skill results, checks the current source and content hash, and reports the first missing offset. Gaps, changed content, and truncated tool results do not prove a full read. Compaction carries hashed read records; durable results recover shortened history. Legacy history without hashes requires reloading. This enforces selected paths; after loading a parent, agent must confirm complete task selection with `references=[...]` and a reason based on parent links, including shared foundations and verification. Empty selection needs reason. On child-reference or nonzero-offset reads, an empty `references` array is treated as omitted and does not replace the parent's selection; nonempty selection still requires the parent at offset zero. Lexical routing remains advisory and cannot prove semantic completeness.

Read evidence is loader/tool metadata, separate from skill prose and the display manifest. Prompt-supplied `skillReads` metadata is discarded; a skill body cannot declare that another file was read. Compaction retains up to 12,000 characters of serialized read records and reports shortening; the guard can recover older ranges from durable results.

Body deduplication is separate from that durable read proof. Reuse requires current-source chunks still visible in active context, including direct reference loads. Compaction summaries and pruned results do not prove body availability. If compaction removed the instructions, requesting them loads the body again; if the source changed, its new hash also requires reloading. Durable originals are retained.

Compaction retains bounded loading history with source, character ranges, and pending paths alongside the summary. Tool outputs remain exempt from ordinary pruning, but full compaction can remove their bodies from active context; reload needed instructions. Loading history is capped at 12,000 characters and visibly reports shortening; durable tool results remain available for omitted ranges. Root objective stays in durable execution state and every work turn; summaries must preserve acceptance criteria, constraints, verification limits, and checkpoint reasons.

AtomCLI and external coding-agent plugins have separate registries. A skill shown by another harness is not automatically loaded by AtomCLI. Use AtomCLI's selected source to identify the active definition. `frontend-design` covers the current interface, layout, and user flows; `create-design-system` covers shared tokens, reusable primitives, and component documentation across screens. Build copies of one source are not additional authored skills.

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

Bundled `game-development` guidance covers playable digital games. Its triggers use game-specific phrases so ordinary 3D modeling and unrelated code work do not load it. When several triggers match, longer matching phrases appear before generic words in the short suggestion list.

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

## Bundled domain trees

The repository ships focused routers with progressive references:

- `frontend-design`: foundations, accessibility, motion, responsive product surfaces, portfolios, CVs, dashboards, 3D, and game UI.
- `game-development`: design, architecture, fixed-step physics, 3D rendering, controls/camera, UI feedback, browser/native paths, AI, audio, testing, performance, and genre recipes.
- `Document Suite`: PDF, Word, spreadsheets, presentations, OCR, conversion, filing, and verification.
- `media-analysis`: local/public video and audio intake, transcription, YouTube/Instagram boundaries, keyframes, evidence reports, and download policy.
- `presentation-design`: narrative, visual layout, PPTX workflow, verification, and HTML slides.
- `ros2`: ROS 2 workspaces, nodes, interfaces, QoS, launch, TF2/URDF, simulation, robot stacks, bags, testing, deployment, and safety.

Use the smallest route that covers the request. Cross-domain work follows explicit links: frontend game shell → game-development; media findings → Document Suite; slide design → presentation-design plus Document Suite for file operations.
