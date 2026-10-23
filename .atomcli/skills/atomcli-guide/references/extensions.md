# Agents, skills, commands, and MCP

Whole-reference loading requires an explicit instruction such as “read all references” or “load the skill tree”. Advice to select necessary references retains bounded parent selection; a qualified reference path requests that file rather than the entire skill or dependency catalog. “Reading list” is ordinary task content, not a reference-loading request.

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

Frontend/game quality guidance uses a short brief, a meaningful first journey, and one bounded experience review. Inspect actual desktop/narrow browser screenshots; DOM assertions prove behavior separately. Model history places screenshot attachments after the producing tool call/result, identified by call ID. Review populated content and rendered scene geometry; report quality limitations without inventing aesthetic completion gates. See `docs/prompts.md` and `docs/SKILLS-GUIDE.md` for the maintained method.

The game's selected 3D reference covers scene composition, world-scale prop alignment, silhouettes, materials, ground contact and camera framing. For a 3D browser game, use the minimum set `frontend-design`, `game-design`, `3d-rendering`, `controls-and-camera`, and `testing-and-verification`; load other game references only when a concrete requirement needs them. Its testing reference illustrates observing a physical movement goal within one bounded browser flow. These are task-specific methods, not new acceptance gates or mandatory whole-library reads.

Game experience review judges actor/goal recognition from actual rendered forms and predicts camera/geometry tradeoffs. Source names and passing HUD checks cannot excuse an ambiguous model, empty setting or poor framing.

The first started frame must be reviewed after onboarding is dismissed. Near geometry, a dot-sized actor, a wall-only view, or canvas interception of HUD controls is a composition defect requiring camera/layout repair before detail work.

Single-file/offline delivery can include a locally bundled renderer when dependencies are allowed; it does not imply handwritten WebGL. Explicit no-dependency constraints, licensing notices and offline runtime verification remain respected.

Manage discovered skills:

```sh
atomcli skill list
atomcli skill show <name>
atomcli skill add <github-url-or-repository-path>
atomcli skill remove <name>
```

A skill folder requires `SKILL.md` with `name` and `description`. Optional `trigger_words` surface it as a candidate when the user message contains a matching word or phrase at word boundaries, case-insensitively:

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

The agent sees skill names, descriptions, and sources. Ordinary trigger matches add at most three advisory suggestions; descriptions decide relevance. Explicit names, directory aliases, `@skill-name`, and reference paths resolve independently of that limit. Missing or ambiguous references are reported; canonical skill/reference permissions apply even through aliases. Automatic loads needing approval defer to the skill tool.

`skill(action="load", name="skill-name")` returns a bounded root body and catalog. Select references from the parent with `references` and `reason` before loading their bodies. An unselected parent read supplies no reference bodies. Use `task` for dependency and selected-reference ranking context; ranking does not determine required instructions. Exact user-requested paths load directly. `name="skill-name/references/file.md"` reads a reference; bare `references/file.md` works only when one accessible skill contains it. Traversal and symlink escape are denied.

Skills may declare mandatory `dependencies: [{ name: frontend-design, when: [web, browser, html] }]`. Dependency-first resolution rejects missing names and cycles; mutation checks require their parents and selected references. Current hash-confirmed reference ranges are reused or resumed; changed sources reload. Within one reference-loading result, identical complete sections are shown once with a source attribution when this shortens output. Unique or changed text, fenced examples and partial chunks stay intact; original hashes, ranges and read budgets are unchanged.

Mutating 3D game contracts route the available `game-development` skill and its dependencies before mutation without an explicit skill mention. Automatic loading injects parent instructions; the agent selects references before editing. Unselected keyword-ranked reference bodies stay out of automatic context. Inspection-only tasks retain advisory suggestions.

Ordinary work turns advertise inspection, skill loading, and control tools while required reads or reference selection are pending. Implementation tools return after those reads complete; the existing admission check still protects mutations and completion.

Parent and explicit reference chunks accept up to 48,000 characters and 2,000 lines. Automatic references share a 40,000-character/1,800-line cap per skill, and automatic context has a 48,000-character content budget across skills. Parent loads include task-relevant references in the same result and record an explicit empty selection when none apply. Reference names accept `references/file.md` and `skill-name/references/file.md`. Large chunks load partially; every deferred path, offset, and error is visible. Continue with the reported offset and limit. A catalog is not a full read. Manifests describe omissions from that result; use confirmed earlier chunks or load remaining content before relying on it.
An empty `references` array on a child-reference or nonzero-offset read is treated as omitted; it does not replace the parent's selection. Nonempty selection still requires the parent at offset zero, and an empty parent selection still needs a reason.

Active executions block file-changing `write`/`edit`/Bash calls and successful completion until explicitly requested skills/references and parent-selected reference paths are fully read. Confirmed ranges must cover current source content without gaps; content hashes invalidate stale reads. Truncated results do not count. The error gives the next missing offset. Compaction preserves hashed records, with durable results available for shortened history; legacy records without hashes need reloading. This guards selected paths, not semantic completeness of lexical routing.

Trusted reads come from loader/tool metadata, separate from skill prose. Prompt-supplied `skillReads` is discarded. Compaction keeps up to 12,000 characters of serialized read records, reports shortening, and leaves durable results available for older ranges.

Visible current-source bodies are reused, including direct reference requests. Durable read records and summaries do not prove the instructions remain in active context; bodies removed by compaction and changed sources reload. This deduplication does not change mandatory-read evidence.

Compaction preserves bounded skill source/range/pending history, capped at 12,000 characters with an explicit shortening notice. Recover omitted ranges from durable tool results. Full compaction can remove instruction bodies; reload needed references. Root objective remains in execution state on work turns; summaries preserve constraints, acceptance criteria, verification limits, and checkpoint reasons.

`frontend-design` covers the current interface and flows; `create-design-system` covers reusable tokens, primitives, and component documentation across screens. AtomCLI and external coding-agent plugin registries are separate. Only the source selected by AtomCLI establishes which definition it loaded; build copies do not count as separate authored skills.

Skill names should be unique. On a collision, the first discovered definition wins: project `.claude/skills/` and `.atomcli/skills/`, then project `.atomcli/skill/`. A source checkout uses its bundled `.atomcli/skills/` tree before older global copies; installed builds use their bundled tree after global locations. Duplicates log a warning; session/tool listings disclose selected and shadowed paths. The TUI skill picker shows source location. Check `atomcli skill show <name>` from the intended project. Keep `SKILL.md` focused on scope, routing, safety, and verification. Put detailed workflows in small `references/` files and link to them from `SKILL.md`.

Bundled skills are packaged into a checksum-covered release archive from the repository's tracked `.atomcli/skills/`, then installed in the global skills directory. Runtime configuration, dependencies, credentials, logs, inbox files, and session state under `.atomcli/` must remain ignored and must not be bundled.

AtomCLI ships an `atomcli-guide` skill for product usage and source-development questions. In a source checkout, update its relevant reference together with the canonical documentation and validate it with:

```sh
cd AtomBase
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json bun test test/skill/atomcli-guide.test.ts
bun run --conditions=browser ./src/index.ts skill list
```

## Custom slash commands

`/atomic-work <goal>` is a reserved native command for durable goal execution. The parent inspects code, records Task tool definitions with dependencies, ownership, agents, required skills, and nonempty acceptance, then awaits the existing orchestrate scheduler. Shared foundations precede consumers; a final integration root depends on all implementation tasks. Empty goals are rejected; ordinary prompts do not activate this mode.

The ledger is authoritative. At most four independent tasks run together; missing ownership or a non-git project serializes work. Required isolation fails without a real git worktree. Children submit results; automatic commands, criterion-level reviewer evidence with real reviewer identity, and explicit parent checks determine acceptance. A generic PASS or parent-supplied automatic result cannot bypass verification.

Git children edit temporary worktrees while their session history, activity, permissions and cancellation stay available in the parent directory. Removing a worktree does not remove its child session. Ordinary public session access remains directory-scoped.

Task actions have strict, separate schemas. Initial `plan` accepts only tasks and global acceptance; revision placeholders are rejected without changing the ledger. Generic Task runs, agent spawns, orchestration plans, and Taskflow plans are unavailable while Atomic Work is active; Taskflow checkpoint controls remain usable for budgets. Automatic cross-project recall and user-memory context are suppressed. Discover actual agent/skill names; omit model for routing, and use `isolation="auto"` without Git. Split work by bounded deliverables; dependency-ordered tasks may share the final file.

Passing parent/reviewer checks require current runtime evidence matched to stored tool arguments and raw output. Parent checks include `runtime={criterion, setup, action, expected, observed, evidence:[{tool:"browser"|"bash", input:"exact arguments as JSON", output:"exact raw output excerpt"}]}`; criterion matches the acceptance description. Reviewer/parent criteria cannot contain commands. Static search/no-op commands cannot prove behavior. Reserved `atomic-global-*` criteria verify the complete integration goal through parent runtime evidence by default; explicit review opt-in uses a reviewer. Weak planner checks cannot replace global acceptance. Semantic coverage still needs verifier judgment.

A normal message during Atomic Work becomes pending input and pauses dispatch, patch application, and completion. The parent classifies it through `task(action="revise", expectedVersion=..., amendment={messageID, classification, evidence})`. Amendments require changed definitions and per-task expected versions; status questions preserve definitions; stop requests cancel execution. Revisions archive snapshots, invalidate downstream work once, preserve independent accepted tasks, and reject stale child patches. Another `/atomic-work` invocation amends the unfinished goal; after acceptance it starts a new goal.

If the first plan does not exist yet, classify the amendment first without definition changes, then plan the extended goal. The original global objective remains available for integration review. Planned amendments still require changed definitions.

`task(action="status")` exposes IDs, versions, criteria, evidence, and pending messages. `plan` records the DAG, `execute` awaits it, and `verify` collects checks. Missing criteria keep work unaccepted. Retry counts survive restart; interrupted mutating work requires reconciliation. Terminal resume copies plan, amendments, and history while preserving source execution and budget lineage. Completion requires all implementation tasks and integration root accepted with no pending amendment. See `docs/ATOMIC-WORK.md` in a source checkout.

The source checkout also includes `docs/ATOMIC-WORK-FORENSICS.md`, a deterministic native Browser OS lifecycle test, and manual live-model retry instructions. Its scripted fixture tests orchestration and skill context, not functional 3D games or final product quality.

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

Built-in Superpowers commands are listed under `/agent` as `/agent brainstorm`, `/agent write-plan`, and `/agent execute-plan`; short forms `/brainstorm`, `/write-plan`, and `/execute-plan` still work when typed but are hidden from the root menu. Put a topic, goal, or plan after the command name. The chat displays your command while the template is supplied to the model behind the scenes.

Typing `@` in the TUI prompt lists available skills and agents. The skill list comes from the active server directory; selecting a skill leaves `@skill-name` in the draft for the rest of your request.

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

Important: `mcp add` and `mcp install` collect, test, or print configuration; they do not silently persist and enable every server. OAuth client-secret snippets use a placeholder rather than echoing the secret. Add the printed entry to the intended `mcp.json` or `mcp` config field, then verify with `atomcli mcp list`.

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
- OAuth credentials retain their authorization-server issuer and cannot be reused with another issuer. Dynamic
  registration cannot replace configured client credentials. Older refresh tokens without an issuer may require
  `atomcli mcp auth <name>` again.
- Use `atomcli mcp debug <name>` for OAuth diagnostics and `atomcli --print-logs` for broader errors.

## Bundled skill trees

Domain skills use short `SKILL.md` routers with focused `references/` files. `frontend-design` routes to accessibility, performance, 3D, portfolio, dashboard, CV, motion, and game UI guidance. `game-development` routes to fixed-step simulation, rendering, controls, AI, audio, testing, performance, and genre recipes. `Document Suite` covers PDF, Word, spreadsheets, presentations, OCR, conversion, filing, and verification. `media-analysis` covers bounded public/local video and audio analysis with timestamped evidence. `presentation-design` covers narrative and slide layout, while `Document Suite` handles PPTX file operations.

When a task crosses domains, load the linked companion skill before the relevant implementation phase. Do not load every reference by default.

ROS 2 work uses the bundled `ros2` tree for workspace, graph, QoS, launch, TF2, simulation, testing, deployment, and safety guidance.
