# Developing and contributing to AtomCLI

This reference is a contributor rulebook, not authorization to edit, commit, push, publish, or release. In an AtomCLI checkout, read the repository's current `AGENTS.md` first and follow any more recent instructions there.

## Repository map

| Location          | Purpose                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `AtomBase/`       | Main `atomcli` CLI, server, TUI, integrations, and tests         |
| `libs/sdk/js/`    | JavaScript SDK and generated v2 client                           |
| `libs/companion/` | TypeScript companion bridge, pairing auth, and discovery package |
| `companion/`      | Flutter Android/iOS companion application                        |
| `.atomcli/`       | Tracked bundled skills/agents plus ignored local runtime state   |
| `.claude/`        | Tracked compatibility assets plus ignored local runtime state    |
| `docs/`           | User and contributor documentation                               |

The monorepo root is not the primary package. Run package-specific commands in the relevant package directory; root `bun turbo` commands coordinate the workspace.

## Non-negotiable environment rules

- Use Bun only. Do not use npm or Yarn.
- Use the Bun version pinned in the repository's package manager field and lockfile.
- Do not enable TypeScript strict mode; `strict: false` is intentional in both TypeScript configurations.
- From `AtomBase/`, run source with the browser condition:

```sh
bun run --conditions=browser ./src/index.ts
```

The `--conditions=browser` flag is required for TUI and SolidJS resolution. Omitting it can produce silent import failures.

## Safe start for every change

1. Read the root `AGENTS.md` and any nearer instructions.
2. Inspect `git status --short` before editing; preserve user changes and unrelated work.
3. Locate the owning package and existing tests.
4. Use `rg`/`rg --files` to follow established patterns before introducing a new abstraction.
5. Make the smallest coherent change and add a regression test that observes behavior.
6. Format, typecheck, run focused tests, then run the appropriate full suite.
7. Re-check the diff and repository hygiene before handing off.

Do not infer permission to commit, push, tag, publish, or create a release from permission to implement a code change.

Binary builds require Git and bundle only tracked `.atomcli/` and `.claude/` files, using current working-tree contents. Ignored/untracked private state and deleted assets are excluded; symlinks are rejected. New release assets must be staged before testing their bundled form.

Plugin event subscriptions retain their initialized hooks for the instance lifetime. Publishing the final disposal event does not initialize plugin/config state again.

## Package and test commands

Bun 1.3.14 resets the preload's `setDefaultTimeout` between files despite `test.timeout`. Slow integration files must set their bounded timeout locally; see `AtomBase/test/tool/atomic-work.test.ts`.

Scripted PTY fixtures reuse installed dependencies and disable downloaded auth plugins, including session resume. Live `pty-smoke.py --home ...` runs retain normal plugin loading.

From the monorepo root:

```sh
bun install --frozen-lockfile
bun run dev
bun turbo typecheck
bun turbo test
```

The root `bun run dev` wrapper loads the CLI from `AtomBase/` while preserving the monorepo root as the active project directory.

Root `bun turbo test` includes AtomBase and Companion bridge tests. AtomBase declares CI's `ATOMCLI_TEST` and `ATOMCLI_BASH_SANDBOX_BYPASS` for forwarding and cache keys. SDK builds always regenerate from the current server; they are uncached so generated-SDK diff checks cannot pass on an old build log.

The tool-list API exports Zod parameter schemas through the native JSON Schema converter, preserving required fields and validation constraints.

Security updates retain Zod 3 where ACP/Jimp require it; `bun audit` still reports GHSA-mrhx-c7xc-m3w5 for those transitive copies. No patched Zod 3 is available; do not force a major-version override or suppress the advisory.

From `AtomBase/`:

For one delegated task, `orchestrate` accepts `{ "request": "plain-language task" }` in one call. Omitted `action` means `run`; multi-task DAGs still use `plan` and `execute`. Dispatch enforces `task` permission for each agent.

`agent` uses blocking `spawn` for one task. Use workflow `plan` then `execute` for parallel independent tasks; `dependsOn` expresses prerequisites. `timeoutSeconds` limits waiting, while `executionTimeoutSeconds` limits the child attempt. Timeout/cancellation fences the child and preserves sibling work. A failed workflow requires explicit evidence-backed `recover` (task version/revision plus workspace artifacts and verification) before successful completion; a terminal `blocked` report preserves the failure without recovery or waiver.

For negative tests, use workflow status's root execution view, durable task states and child invocation timestamps/reasons, then required artifact/parent test checks. Report unavailable provider-attempt details as unverified unless explicitly required; no internal storage discovery is needed for an ordinary test report. A running root cannot observe its future terminal state. Failed-workflow observations do not reset no-progress counters; actual artifact revisions, plan changes and browser checks still count. Root `finish` and `continue` checkpoints with failed obligations become `blocked` without another work grant and publish a non-success report; unknown mutating work stays unresolved. Model-call/step budget errors also publish a durable text report, with a deterministic fallback when model text is unusable. See `docs/DEVELOPMENT.md` and `docs/CHILD-TIMEOUT-COMPLETION-AUDIT.md`.

The child deadline starts before runtime spawn and includes preparation, permission waits, model streams, tools, and checkpoints. Files and passing tests alone do not prove completion: check the final `agent_result`, invocation state, and task acceptance. Exact `/dev/null` shell redirection needs no external-directory grant; other redirects and bash permission remain checked. Already-started tool work can settle after cancellation under the original owner/fence/lease and cancellation CAS revision. Aborted mutating work stays `unknown`, read-only work becomes `cancelled`; unknown effects need explicit reconciliation and cannot approve a failed workflow.

`agent_result` uses the shared `WorkflowBlackboard.StructuredResult` schema: `facts`/`decisions` contain strings or `{ key?, value, evidence? }` objects; `tests`, `failures`, `constraints`, `openQuestions`, `editedFiles` contain strings only. Non-blocking editor warnings belong in facts/constraints; required check failures must remain failures. Format errors get field-specific feedback for report correction in the same child session, bounded by task `maxRetries`; zero disables retries. Invalid or incomplete results are never accepted from files/tests alone.

`isolation="auto"` uses Git worktrees when available, otherwise the existing guarded shared workspace. `isolation="required"` needs a Git worktree; a non-Git plan is rejected before child/task/blocker creation, without silent downgrade. Execution still checks isolation for persisted plans and workspace changes.

An isolated child's ownership prompt names its own execution worktree, not the parent directory. Workflow ownership uses the Git worktree when the session runs inside it; otherwise it uses the active session directory, including `/tmp`. `owns` accepts relative paths from that root or absolute paths inside it. Claims are literal file/directory paths, not globs; patterns such as `wordCount*` are rejected. List `wordCount.ts` and `wordCount.test.ts` separately and keep those names in the task prompt. Children receive the ownership root and claims in a `task_ownership` prompt block. Traversal and symlink escapes are rejected before planning or dispatch. A rejected plan creates no workflow tasks or blockers. Ownership does not grant permission: children retain permission checks and parent denies. Do not retry a denied path through another tool or child. Workflow attempts stop on deterministic permission/ownership errors or terminal runtime constraints; provider, QA, and result-validation retries remain bounded. Child assistant errors preserve `data.message` in the parent result.

Git-free children with `owns` write through `edit`/`write`, with checks on both supplied and canonical paths. Their shell commands require an OS read-only sandbox (`bwrap` on Linux, `sandbox-exec` on macOS); unavailable enforcement fails closed. The parent can run the automatic acceptance commands. Git isolation and its ownership-checked merge remain unchanged. Failed workflow checkpoint messages include the durable workflow ID and state; recovery still requires artifact and verification evidence.

Recovery checks supplied paths and resolved symlink targets against workspace, task ownership, and read permission; retargeted links are rejected before reading. It verifies unchanged artifacts and mutation revision. Original acceptance criteria remain authoritative. Cancellation wins over late ordinary completion/failure; child deadline maps lifecycle `timed_out` to durable invocation `failed` with `deadline` evidence. No-progress finalization produces `blocked/resource_limit`; only a hard step limit produces `budget_exhausted/step_limit`.

```sh
bun run dev
bun run typecheck
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json bun test
```

The Python-stdlib PTY regression in `test/cli/tui/pty-smoke.py` waits for the prompt, sends typed bracketed paste and Enter separately, checks durable completion/cancellation with a scripted provider, and exercises resize, session navigation, multiline input and exit. Echoed prompt text alone is not proof of submission or live model quality.

Focused test file:

```sh
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json bun test test/file/ignore.test.ts
```

Focused test name:

```sh
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json \
  bun test test/file/ignore.test.ts -t "match nested and non-nested"
```

Provider tests are opt-in:

```sh
bun run test:providers
```

Live provider audits require their explicit environment flags and real credentials. Default tests must use fixtures and must never call live provider APIs.

Dependency security maintenance is documented in `docs/DEVELOPMENT.md` under "Dependency security updates". Update
small groups, record before/after audits and focused tests, then validate the full workspace. Use
`bun turbo test --force` for a fresh run. Root overrides enforce patched transitive dependencies and one SolidJS
runtime; the gray-matter patch supports the current YAML API without the legacy argparse/sprintf-js chain.
Validate TUI/PTY, image decoding, provider/MCP transports, and frontmatter when their dependencies change. YAML 1.2
uses an explicit `0o` prefix for octal values. Do not hide unresolved audit findings.

## Test isolation rules

- Tests use `bun:test` and live under `AtomBase/test/`, mirroring source paths.
- Any test file that imports `src/` must import `test/preload.ts` before the source import. `xdg-basedir` reads environment variables at module import time; the wrong order corrupts test isolation.
- Provider-touching tests require:

```sh
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json
```

- Do not “fix” default tests by adding real credentials or network calls.
- For listeners, companion sockets, and concurrent services, add tests that verify resource cleanup and explicit-versus-automatic port semantics.

## Storage recovery boundary

Current AtomCLI processes coordinate JSON-backed records through a SQLite/WAL manifest and immutable content blobs. Reads validate cache revisions, read-modify-write updates use bounded compare-and-swap, and deletion tombstones prevent stale legacy files from resurrecting data. Session message and part writes and removals validate a durable session generation in the same manifest transaction. Deletion increments and tombstones the generation before transcript purge; a late projector converts its pending delivery to an idempotent abandonment. Recovery scans committed completion outboxes in pages of 50, so 101 pending records do not stop recovery. The first cutover creates a verified, credential-excluding backup at `~/.atomcli/data/storage-backups/cutover-v1`; malformed legacy JSON remains in that backup for recovery instead of being silently discarded. Restore code must verify hashes, support dry-run, target an empty directory, and publish only a completely copied staging directory.

An interrupted cutover opens from existing manifest keys instead of hashing the whole legacy tree again. Missing records and requested list prefixes are imported lazily; a fresh cutover marks completion only after its full import, and tombstones always override legacy files.

Run the three `test/core/storage-{manifest,backup,migration}.test.ts` suites after changing this mechanism. A newer on-disk manifest format must fail visibly rather than being downgraded.

Data retention uses a global 1024 MiB snapshot object budget and 2 MiB per-file limit, plus a 64 MiB / 10,000-file tree ceiling. Capture stops at the budget while existing rollback remains; excluded files cannot be rolled back. Native project Git ignore rules apply, with runtime/dependency directories excluded. Full request/tool replay copies default off; maintenance discards saved requests while disabled and expires opt-in diagnostics after seven days; chats, normal tool results and durable execution accounting remain. Replaced blobs retire immediately after commit if no pointer shares them. Maintenance compacts verified legacy originals, then sweeps old orphan blobs and unused snapshots; the cutover backup stays. Background maintenance starts after 30 seconds, checks hourly, and defaults to a daily pass, 24-hour orphan grace and 1024 MiB sweep budget. Existing oversized snapshots require explicit cleanup; live records have a fixed 2 GiB admission ceiling: growth fails visibly rather than deleting history. Backups, binaries and legacy data are outside that accounting. Preview with `bun run --conditions=browser ./src/index.ts debug storage --all-projects`; add `--apply` to execute. Restart older processes first. Missing roots, unreadable records, unsafe directories and unfinished/uncertain executions block snapshot pruning. Run `test/core/data-retention.test.ts`, the snapshot suite and storage recovery tests. See `docs/DEVELOPMENT.md` for configuration and safety.

## Formatting and TypeScript style

Prettier configuration is inherited from the root package:

- no semicolons;
- double quotes;
- `printWidth: 120`;
- no ESLint or Biome workflow unless the repository later adds one.

Format AtomBase sources with:

```sh
bunx prettier --write "src/**/*.{ts,tsx}"
```

Prefer path aliases over deep relative imports:

- `@/*` maps to `AtomBase/src/*`.
- `@tui/*` maps to the TUI source directory.

Follow the repository's observed import grouping: external packages and Node built-ins, relative siblings, then alias imports. Avoid `../../` chains across directory boundaries.

Types are Zod-first:

```ts
export namespace Example {
  export const Info = z.object({ name: z.string() })
  export type Info = z.infer<typeof Info>
}
```

Use named namespaces for modules, object-literal types where practical, camelCase values/functions, PascalCase types/namespaces/classes, and SCREAMING_SNAKE_CASE module guard constants.

## Runtime import constraint

Files built with `--conditions=browser` must not top-level import the `ai` SDK at runtime. Use type-only imports for types and dynamic imports for runtime access:

```ts
import type { SomeType } from "ai"

const { runtimeExport } = await import("ai")
```

A top-level runtime import can cause Bun ESM resolution failures that appear silent.

## State, logging, and errors

- Use `Instance.state()` for project-scoped cached initialization. Avoid unbounded mutable module-level state.
- Log with `Log.create({ service: "name" })` or `Log.Default`; do not add `console.log` to service code.
- Throw `new Error("message")` and let it propagate unless a boundary has a defined error translation.
- Put byte, item, retry, workflow, or time bounds in named constants at module scope.
- Preserve backward compatibility in `Config.Info`. New config fields must be optional and should have safe defaults; do not rename or remove existing fields.

## Tool implementations

Tools live under `AtomBase/src/integrations/tool/` and register through `Tool.define()`.

The execute result contract is:

```ts
{
  title: string
  output: string
  metadata: Record<string, unknown>
}
```

Do not change the `Tool.Info` return shape without updating every implementation. The wrapper already validates Zod input and truncates output at 2,000 lines or 50 KB. Set `metadata.truncated` manually only when the tool performs its own internal truncation.

The edit tool's fuzzy matching and failure behavior are deliberate. Preserve its fallback chain and never turn a failed match into a silent no-op. An unread small file can be returned as a permission-checked snapshot on an `edit` or `write` attempt; a large file still needs an explicit read before a full overwrite.
An unread-file edit remains unapplied but supplies a bounded excerpt and content hash when read permission permits it. The next edit can use that snapshot; denied reads reveal no content.
An execution may reuse its original Read content hash after its own successful edits while the file matches its last written revision. Read anchors follow the execution's edits while their boundaries remain clear; crossing edits require another Read.

## Agents and orchestration

- Frontend work records a short product brief in its existing plan and builds a meaningful user journey first. New playable games select game-design guidance and prove a real input playthrough to an objective and restart. One bounded experience review identifies the strongest remaining user-impact weakness in the rendered interface, batches material repairs and reports remaining quality limitations; optional visual polish and formatting are advisory unless explicitly requested. Correctness and product quality are evaluated separately; there is no visual-score completion gate or mandatory reviewer chain. See `AtomBase/evals/README.md` for live quality comparisons.

- Native agents are defined in the state factory in `AtomBase/src/integrations/agent/agent.ts`.
- User agent Markdown files extend or override native agents; they do not replace the native registry wholesale.
- The orchestration session-map key format is `parentSessionId:agentType:taskId`. Changing it breaks workflow cleanup.
- The workflows map is bounded to 100 entries and has one-hour TTL cleanup. Do not remove those bounds.
- Orchestrated subagents must always be denied `todowrite`, `todoread`, and `task` permissions.
- Tracked work is durable in the execution ledger. Child output is `submitted`, not accepted. Atomic `agent(action="verify")` checks acceptance; `agent(action="revise")` reopens affected dependencies while preserving unrelated accepted work. Legacy task calls remain compatible. Workflow and TUI task completion require ledger acceptance; stale workflow success is repaired on reload.
- Generic ledger checks accept only parent/reviewer evidence. Automatic checks derive success from the configured command's exit code, not an external `passed` flag. Each stored check carries `verifier`, `verifierID`, `taskRevision`, and `verifiedAt`; old revision checks cannot approve current work.
- Task revision history and `supersedes` remain intact. The ledger rejects missing dependencies and cycles. Orchestrate clears stale output and completion state on revision, including status after reload. Stale child results leave the workflow resumable; failed acceptance can retry `needs_revision → running` within its retry budget.
- Session cleanup is owner-scoped: an older run must not cancel a replacement run for the same session.
- An exhausted model retry budget is terminal. It must not wait, select another fallback, or issue another model call.
- A final-step completion blocked by open taskflow, workflow, or child work becomes a visible `budget_exhausted/step_limit` result. It must not create a tool-less synthetic continuation or leave a reasoning-only assistant message with no terminal status.
- Explicit inline-code directory targets in English creation requests (`in`, `inside`, `under`) or Turkish requests (`klasöründe`, `dizininde`, `içinde`) are checked against actual deliverable files before completion. Missing files trigger bounded repair or terminal non-success, not reviewer approval. Checkpoint prose alone is never a gate; broader acceptance requires explicit task checks. Each Bash call starts a new shell; `mkdir` does not change `workdir`, and ancestor package configuration can make tests pass in an empty child directory.
- A root checkpoint cannot finish while durable taskflow steps remain open. It grants a bounded work slice so the parent can receive child review results, fix defects, and reconcile the plan. Child reviewer checkpoints can finish independently of the root plan. The step threshold requests one checkpoint when first crossed; later turns continue until another checkpoint cause or a hard budget limit applies.
- Explicit independent review steps remain open until reviewer PASS. Ordinary completion does not create such a step. Timeout/cancellation/inconclusive is separate from code-task completion.
- Child prompts must preserve the user's acceptance criteria. A delegated browser game cannot replace a requested real 3D renderer with a 2D perspective drawing.
- After a delegated task edits files, its `agent_result` must be valid JSON with `status: "complete"` and an empty `failures` array before workflow completion. Missing, malformed, or explicitly incomplete results are retried within the task limit and otherwise reported as failed, even when automatic reviewer QA is disabled.
- Read-only reviewer/checker status describes inspection; product verdict and findings describe code quality. Incomplete optional QA is preserved separately, never PASS, without repeating completed worker side effects.
- Watchdog tracks semantic signatures (normalizing command and working directory) and blocks repeated verification calls without new mutation evidence after three unchanged results.
- Reminder injection is tied to new mutation revisions and distinguishes production code from test, fixture, generated, and example paths to prevent false-positive loops.
- When execution limits are reached, finalization proceeds unidirectionally: work tools are disabled, the model is given one final turn and one repair attempt, and a rich deterministic fallback is generated if no usable text is returned, ensuring zero empty assistant turns.
- The final configured agent step receives the maximum-step instruction with an empty tool set.
- A workflow can have only one live `execute` owner. A stopped checkpoint is resumable; a concurrent execute request reports the existing run instead of resetting its tasks.
- Optional `execution_budget` limits use a persistent SQLite/WAL ledger. A root request and its child sessions share atomic model-call, agent-step, duration, and cost admission; adaptive work runs in 30-call slices with append-only, user-visible, tool-free model checkpoints and bounded (50-call) slice requests. Slice extensions stop after twenty grants, and repeated calls, targets, errors, or consecutive no-progress slices stop new work and enter a separate tool-free final-response phase that does not consume work allowance. The report distinguishes technical, verification, and procedural harness blockers. A granted checkpoint slice extends adaptive work allowance in the same durable transaction (bounded by the twenty-grant ceiling); explicit call/step limits, configured cost ceilings, and the deadline remain hard. Plan revisions are retained and may reopen completed work when new evidence appears. Dispatched calls whose outcome is unknown remain conservatively charged after restart. Verification probes keep the originating execution context and abort when the caller, deadline, or execution lease is cancelled.
- Changing the model route alone does not count as verified progress across checkpoint slices.
- Native static checks preserve Bun compiler error messages and positions, including constant assignments accepted by `node --check`. HTML positions are relative to extracted inline scripts; TS/JSX positions use emitted JavaScript. Isolated snippets must retain their declarations and parameters to provide meaningful symbol evidence.
- Browser globals include `EventTarget`; keyword-named object/class methods such as `get(...)` retain their parameters. Undefined values in those methods still fail.
- Real-time games keep running between tool calls. Keep reset/start, `input_sequence` and state/frame assertions in one browser `flow` (at most 20 steps), so model reasoning latency cannot expire the test before its observations.
- A settled click timeout with an intercepted final pointer attempt is failed, without PASS evidence. An unmatched input attempt, completed click waiting on navigation, transport loss and cancellation remain uncertain.
- Browser `wait(duration)` waits the requested real milliseconds with cancellation. A target plus `text` waits for matching text, including literal `exact` matching; a delay plus a condition checks the condition after the delay.
- Checkpoint and final-response turns use their own output instructions; generic missing-tool advice applies only to ordinary turns with an empty toolset. Protocol-level text-only dispatch, bounded invalid-response retries and raw tool-markup rejection remain enforced.
- A `continue` grant consumes its checkpoint trigger. Unchanged evidence and route/plan state do not immediately repeat a watchdog checkpoint; explicit requests, hard budget limits, and new work evidence still apply.
- Successful tool results provide checkpoint progress when command/result fingerprints change, including write-authorized Bash builds and artifact checks without a `filePath`. Permission classification stays separate. Bash hashes full streamed output, independent of truncation paths. Write authorization alone does not clear bounded result history; known changed files invalidate previous verification results. Unchanged repeated results still trigger the loop guard. Progress evidence alone does not prove acceptance criteria.
- Successful `edit` results acknowledge the applied mutation even when LSP reports no diagnostics; that acknowledgement is not verification evidence. Changed JS/TS/JSX/HTML files receive automatic static checks before child QA/merge, durable task acceptance, artifact recovery and root completion, even with review disabled. The native `static_check` tool is advertised in focused/coordinated scopes; it is not a shell executable. It is read-only: checking never increments the source mutation revision, and a failed result records failed evidence rather than successful progress. Bun validates syntax and removes TS types/JSX before the heuristic symbol check. Failed gates block success; SHA-256 evidence is logged, later changes are rechecked. Unsupported/deleted files are skipped; other read errors and files over 20 MiB block verification. This does not replace project type/build/runtime tests: template interpolation, cross-file ambient globals and emitted-source positions remain limitations. Checkpoint completed-work items are delta-only and must cite concrete evidence; the harness accumulates completed/failure history.
- Recognized native Bash builds snapshot tracked edited inputs before execution. Completion rejects source changes or added inputs after the latest build for the same command/workdir; rebuild before delivering success. Standard Bun/package-manager/Cargo/Go forms are covered. Custom build commands, inputs outside the workdir, untracked external mutations and artifact-only tampering still need project acceptance checks; standalone HTML does not acquire an artificial build requirement.
- TUI shutdown also cancels expired idle waits when the worker still matches the stored owner and fence. Replacement owners are preserved; normal cancellation still validates the lease. Ctrl+C clears a nonempty draft; an empty prompt requests exit confirmation.

- Tool-free finalization buffers text, rejects raw DSML/XML tool-call markup, and allows one report retry. The published stop report uses recorded checkpoints, taskflow steps, command logs, and the runtime reason. A runtime stop cannot become successful completion through report text; child reports preserve the parent execution.
- A tool-free checkpoint turn skips work-step admission after the work-step limit; otherwise the runtime can repeatedly create and remove the same assistant turn without calling the model.
- Checkpoint grants add one adaptive work step per granted tool operation so sequential operations can use their slice. Explicit execution call/step ceilings, cost, deadlines and extension bounds remain unchanged.
- Route guidance and its consecutive-revision count are reconstructed from durable checkpoints after restart.
- A direct answer retains `read` with normal file permissions and a three-tool-call limit, plus `model_control` and `scope_control` for recovery or promotion. Direct execution allows one retry, which can select an eligible fallback model; explicit zero retry limits remain binding. An empty execution-policy allowlist is restrictive, while an absent allowlist permits all otherwise authorized tools.
- Classified scope carries into later turns. A short continuation of unfinished work also inherits the prior intent and required tools. Focused design work can edit files when its contract requires mutation. `lsp` formatting previews by default; `apply: true` writes edits.
- Parent checkpoints do not count a running child invocation as a no-progress slice; extension and execution budgets remain bounded.
- Existing durable taskflow plans retain ordered milestones; auto-activation starts the first pending step, even when a command name resembles a later verification step. Coordinated work exposes `todo` and `agent`; creating a legacy taskflow is not required to start work.
- Build and default agent prompts perform one bounded self-review before completion, then rerun the smallest check needed for any material finding. Simple work does not enter an open-ended audit loop.
- A hidden `invalid` repair tool remains in normal SDK turns and is excluded from `activeTools`; an unavailable call gets a visible result before tools refresh on the next model step. Unavailable `edit`/`write` errors include the concrete mutation-recovery request when `scope_control` is listed. Same-scope mutation recovery skips scope approval; wait for runtime confirmation. Bash must not bypass a denial or user read-only instructions.
- `scope_control` is a metadata control, not workspace work: status does not count as a file mutation or start a pending taskflow work item. To recover omitted writes required by the user task, the root can request `action="escalate", target="focused", needsMutation=true` with a reason (use the current scope if coordinated). Only a broader effective scope needs escalation approval in ask mode. Same-scope mutation recovery works without an approval responder, grants no extra calls/steps, and retains explicit off, counters, cooldown and hard budgets; denial changes nothing. Agent/file permissions and user read-only instructions remain binding.
- Read-only narrowing requires explicit inspection language and no positive mutation verb. "Uygulamayı değiştirme; test dosyasına yaz" retains mutation tools; ambiguous requests do too. File permissions and user restrictions remain binding.
- Focused `answer`, `inspect`, and `design` tasks omit `edit` and `write`. `bash` stays available for diagnostics under normal command permission/effect checks; tool narrowing is not a read-only sandbox.
- Execution classification uses local `TaskProfile` heuristics, shared complexity and risk with model routing; no classifier model call or pre-classification provider initialization. Read-only requests remain non-mutating; runtime evidence may promote scope/risk. Greetings stay direct. Explicit delegation selects coordinated scope. Legacy execution_classification=false keeps conservative defaults.
- Scope and risk are independent: a localized public API or schema edit may stay `focused` while receiving `critical` risk. Scope measures coordination breadth; risk measures impact, so public-contract impact alone does not force coordinated execution.
- Policy resolution reports explicit contradiction diagnostics, such as mutation-required work with no `edit`/`write` capability. Diagnostics do not widen permissions automatically.
- Subagent permission composition preserves ordered scoped exceptions to deny-by-default permissions, including the native reviewer's browser observation allowlist. Global grants do not open interaction or source-write permissions. Concrete hard denies and the final `todowrite`/`todoread`/`task` denials remain enforced; a later explicit wildcard denial closes the allowlist.
- Parent, child, and reviewer work share a root ledger but not ownership. A concrete review claim authorizes reviewer verification during root finalization; native command permissions stay enforced and mutating work is limited to `bash`, `browser`, and `lsp`. Local limits are 30 tool operations, 12 native steps, and 180 seconds. Shared explicit execution, cost, deadline, ownership, and fence limits remain hard. Reviewer verification does not consume root slices, mutation revisions, tool evidence, or checkpoints; reviewed-file changes still invalidate content snapshots and review diffs, and uncertain side effects remain unknown work. Reviewer prompts skip the root completion gate.
- Automatic reviewers require `review.auto: true`. Otherwise the effective policy is visibly `advisory` (or `off` when disabled); configured strategy is retained. Explicit independent-review obligations can still require review. Required review fails closed on timeout, cancellation, infrastructure failure, or inconclusive verdict; outcome is blocked, never success with a warning. Skipped review is `not_required`, never PASS. One reviewer by default; extra reviewers require configuration or explicit request.

Request execution follows one bounded path: prompt turn classification → execution contract → scope-aware policy/tools → verified model route → registry/agent/permission/runtime tool admission → evidence and bounded promotion → checkpoint/review → durable completion. Classification, policy, model proposals, tool registry, runtime admission, and ledger ownership live in the modules listed in `docs/DEVELOPMENT.md`; these layers must not invent independent tool inventories.

3D game acceptance is derived before mutation and shared with review. Requested interaction uses real browser pointer/keyboard input; helper/state mutations and DOM `.click()` are setup, since they can skip pointer/focus paths. `fill()` does not prove physical keypress handling. Check sustained movement in every documented direction with elapsed-time consistency, actual objective progression, and usable forward, quarter-turn and reverse camera views. This evidence distinction belongs to acceptance, not a separate completion gate. Continuations retain it; reasoned revisions record invalidated evidence, clear browser proof, and invalidate cached acceptance. Skill `dependencies` resolve before explicit parent auto-loading and are checked by the existing mutation gate. Current reference hashes/read ranges prevent duplicate body injection; changed content reloads. PTY input/resize/resume fixtures select the built-in `atomcli` theme because their fake terminal does not answer palette queries; these tests do not prove system-palette detection. Browser snapshots prefer rendered text for multiline/grid control labels, retaining explicit ARIA names; concatenated DOM text can produce a name the role locator cannot find. Use browser flows of at most 20 steps, ending interactions with assertions. Every step requires `action`; the entire flow is validated before browser actions, including required element targets, `type` text, `assert` discriminator/target/expected values, and the `drag` destination, so invalid flows remain unapplied. Use `assertion` with its expected value/target (for example `{ action: "assert", assertion: "text", selector: "#status", expected: "Saved" }`); use `evaluate` with `script` for arbitrary JavaScript observation (for example `{ action: "evaluate", script: "document.title" }`). Per-step target validation moved to that schema boundary. Sequence point coordinates are validated before events start: viewport moves/clicks require x/y; element-relative points can default to the target center. Semantic-target actionability timeouts before input dispatch preserve earlier steps without unknown work; failures after dispatch remain uncertain. HTTP/HTTPS verification does not prove direct-file behavior. Readability is advice, not a mechanical completion blocker. Bash timeout terminates the command rather than yielding a running session; persistent test servers require detached execution, redirected stdio and readiness verification. POSIX commands fail fast; Bash/Zsh/Ksh use `pipefail`, including automatic acceptance. Failed Bash exit status remains visible even with empty stdout; explicit shell-execution requests retain Bash capability.

Work slices receive at least 10 calls; mutation work without artifact/browser progress is capped at 10. Late skill/source exploration does not reset stalls, and missing legacy taskflow no longer interrupts work. Planning is advisory. Checkpoint `invalidatedWork=[{claim, reason}]` removes exact invalidated claims from later completed summaries while retaining history. See `docs/DEVELOPMENT.md` for boundaries and limitations.

- A changed browser deliverable or an explicit browser runtime verification task needs a successful browser navigation or reload plus a visual or behavior check after the latest workspace edit before completion. Browser checks count as checkpoint progress; repeated identical calls do not. Read-only browser-tool, flow, navigation, verification, Playwright and input_sequence requests retain browser capability without a second matching action keyword; no source edits does not waive runtime verification. Serve local artifacts over HTTP(S) from the parent workspace; URL preflight failures are not applied. An open verification step at the step limit produces a blocked execution report.
- Existing-site `inspect`/`operate` contracts may verify explicitly requested accessibility/network inspections without substituting them for requested screenshots, visual behavior or game input. Native writes to exact declared, regular, unlinked `.md`/`.txt` findings deliverables preserve site proof; other source edits and unknown Bash effects invalidate it. Acceptance revisions clear all browser proof. Completion points back to the inspected site, not to serving the report.
- Accessibility output supplements the ARIA tree with potential missing labels among the first 100 native form controls; placeholders alone are flagged. This does not cover custom controls, frames, contrast or full accessibility conformance.
- Tree discovery shows omitted immediate directories, respects Git/default ignore rules even with `ignore: []`, and preserves file/directory permissions. Use pattern mode with the exact omitted directory and `pattern: "*"`, or read the known file path; consult local README paths before guessing a root or filename. `path` is an existing directory, not a file followed by `/..`.
- Model-facing edits always use a required nonempty `operations` array, even for one replacement. Native/persisted legacy calls retain top-level `oldString/newString` support. Mixed edits remain unapplied with schema-specific repair guidance. A missing `.json` path is a discovery failure, not a JSON/schema error.
- Successful browser flows count navigation and verification steps without invalidating source evidence. Saved screenshots, downloads and traces still enforce filesystem ownership, including inside flows; owned children use `screenshot(save=false)` or parent file saving. Browser permissions and external-directory checks remain enforced.
- Checklist updates persist session state without workspace or external effects. They retain browser proof and consume allowance; their output neither supplies acceptance evidence nor resets checkpoint stalls. Source edits still clear previous proof.
- Direct Chromium navigation failures with `ERR_CONNECTION_REFUSED` are not applied; failed flows remain uncertain because earlier steps may have applied effects.
- Classifier calls use an 8-second bounded timeout. A timeout falls back conservatively to `focused` rather than blocking execution indefinitely.
- A checkpoint requires structured self-critique, not only a budget decision. The model must answer `routeDecision` (`keep` or `revise`), `selfCritique`, `failedApproaches`, and `whatToChanges` alongside the usual `continue`/`finish`/`blocked` decision. It proposes an alternative route only when the current route is stuck, repeating, or producing no new evidence. A `revise` verdict is not advisory text: the runtime records it and the next work slice receives a `route_guidance` block naming the failed approaches to avoid and the concrete changes to apply. Failed approaches accumulate across checkpoints until the model returns to `keep` or finishes, and four consecutive `revise` verdicts without progress are treated as a stall, so a strategy that keeps changing but never works is stopped instead of granted another slice.
- Coordinated work exposes `todo` for planning and `agent` for delegation; normal tools need no model-authored taskflow. Legacy taskflow/orchestrate/task are compatibility/internal mechanisms. Existing durable plans retain ordered transitions and revision history. External blockers wait durably for user input and resume the same execution; watchdog and extension-ceiling blockers finalize with a user-facing report.
- A prompt can resume a terminal execution by sending `resumesExecutionID`. Resume creates a linked segment but retains the prior `budgetScopeID`, cumulative calls, steps, cost, and original deadline; it can tighten limits but cannot reset or extend them.
- Normal prompt cleanup is distinct from user cancellation. Cancellation targets the captured execution/fence, so delayed cleanup cannot cancel a newer user turn or shared parent/child execution.
- Structured-output contracts are appended at the shared subagent spawn boundary. Reviewer slots persist across retries, an unchanged revision reuses its fresh PASS, and task QA uses the configured reviewer count and review attempt limit while passing findings into worker retries. Reviewer infrastructure failures retry review without repeating completed worker side effects. Successful completion clears root and descendant review state; recovery restores patches only from the current non-synthetic user turn.
- Workflow status, execution, and abort require the current session to own the workflow. Direct child-session abort and legacy `task` continuation check the child's parent; combined abort requests validate both targets before cancelling either one. A supplied `agent` spawn `session_id` must name an existing child of the current session. Stored workflows without an owner cannot be controlled.
- A failure to archive a completed child's output under `.atomcli/runs/` appears in the workflow result. It does not rerun the child or discard completed work.
- Workflow success and failure archives cap text output at 100 KiB and other artifacts at 5 MiB, preserving valid UTF-8 while marking truncation.
- The in-memory workflow limit stays at 100. New plans or restored workflows reject capacity exhaustion; cleanup evicts the oldest terminal records by creation time and never running work. Unexecuted plans older than one hour free memory slots but remain durable and addressable by ID.
- Live benchmark execution prints its JSON report and exits 1 if any case fails, times out, or lacks a passing observation; exit 0 requires all cases to pass, including their independent verifiers. Stored reporting without `--execute` stays read-only and exits 0 when reporting succeeds. Test observations use chronological message order. Turn totals include recovery calls created before the terminal completion time, even when the terminal message was created earlier. Synthetic continuation prompts remain part of the original request; a new real user request starts a separate turn. Benchmark observations, including correction signals, remain in the report but do not update runtime model-quality history; independent verifier results determine benchmark acceptance. Recovery preserves `2>&1` in compound checks; a trailing unquoted stderr-to-stdout duplication does not change Bun test scope. A terminal error is unsuccessful. Failed fixture setup is reverted. Headless benchmark tool-permission prompts are rejected immediately with an explanation; configure explicit permissions for the authorized workspace before execution. No permissions are auto-granted and configured denials remain enforced. To resolve an open verification failure, rerun its full command successfully in the same working directory after repairs; separate passing files do not replace a failed grouped or directory test run.
- Live benchmark execution requires a sanitized disposable Git database and filesystem sandbox excluding original checkouts, reports and backups. Git preflight rejects verifier history/reflogs, alternates and unreachable objects. Keep answer-bearing regressions under private `verify/` trees. Native tools deny evaluator paths and symlink aliases across child sessions. Bash requires Linux bubblewrap with private mount masks and restricted process visibility; unavailable isolation fails before prompting. Stashes use `~/.atomcli-eval-verifier-stash/` (0700), outside trusted runtime data, with legacy recovery. See `AtomBase/evals/README.md`; Git checks alone do not establish host filesystem privacy.
- Agent benchmarks hide every `verify/` directory recursively beneath the cases root outside the worktree, including nested copies. Missing or unreadable case roots and symbolic-link verifier paths fail closed. Discovery does not follow symbolic links; recovery rejects symbolic-link ancestors in both source and stash paths. Recovery manifests are written before each move, validated before restore, and preserved on failure, including when both copies are missing. Restore replaces any verifier directory recreated by the agent. Copy fallback applies only to cross-device moves.
- Workflow capacity reservation and restore use a shared process lock, so concurrent sessions cannot both reserve the last slot.
- Workflow lookup treats only a missing stored record as absent. Corrupt JSON or storage I/O failure surfaces as a recovery error so prior work is not mistaken for a new workflow.
- A workflow left `running` after its execution lease expires becomes `resumable` with in-flight tasks marked `unknown`; it is not replayed automatically. A live in-process run or valid lease keeps its running state.
- Workflow abort attempts every worker and reviewer even if one cancellation fails. Failures remain visible as `unknown` tasks in a persisted `resumable` workflow; retrying abort retries those cancellations without restarting task execution.
- Review claim, reviewer authorization, QA PASS, and completion state are durable. `HarnessState` reviewer verdict counters and in-memory session maps remain process-local; restart recovery restores the durable claim but cannot restore fail-attempt/lifetime ceilings until those counters move into the execution ledger.
- Requested review uses a durable claim bound to concrete sessions and current digest/revision. Only PASS approves a required review; inconclusive blocks completion. An unchanged QA PASS may be reused; names alone grant no finalizing access.
- Candidates bind plan revision, policy digest, and content snapshot. No scope or risk forces reviewers without explicit opt-in. Skipped review is `not_required`, never PASS. Failed checks, unresolved tasks, stale snapshots, and unknown effects still block success.
- Advisory review recommends without automatically dispatching reviewers. Once review is required, infrastructure failure leaves an inconclusive claim and terminal blocked delivery; no warning payload or silent downgrade can commit success. Validated findings retain bounded retries; failed tests and unresolved acceptance remain blockers.
- Terminal success and failure share an immutable execution outcome boundary. `completed`, `failed`, `cancelled`, `budget_exhausted`, and review `blocked` write a fixed delivery outbox and redacted, versioned execution event atomically. Explicit root cancellation has a fixed local delivery even before an assistant message exists; child-only cancellation leaves the root active. Projection claims use a short lease and token, all storage writes use the exact session generation, and ACK requires the same digest, generation, owner, and token. Invalid payloads or missing target messages become visible `recovery_required` records rather than retrying forever. Terminal `finish` and `time.completed` are not made visible before that commit, and a late or stale projection cannot make an older terminal execution active again.
- Session-scoped execution list/detail/snapshot/replay APIs expose this redacted record, including unresolved mutating work IDs and CAS versions. Snapshot state and cursor share one ledger transaction. Cancel and unknown-work reconciliation use idempotent request IDs and exact execution-version CAS; reconciliation also requires exact work version and bounded evidence. Stale/conflicting requests do not mutate state. `/session/status` remains transient busy/retry/idle compatibility state, not proof of success.
- Durable execution cursor, transient global SSE cursor, and Companion bridge cursor are separate domains. Epoch changes, ahead cursors, or retention/buffer gaps require snapshot resynchronization. Budget and blocker changes advance resource versions; 80% and 100% cost warnings are emitted once per configured scope and policy version. Global and instance SSE queues are bounded to 256 pending events or 2 MiB and release subscribers/timers on abort, overflow, and write failure.
- Session deletion carries the tombstone generation into an idempotent `execution.deleted` event, preserves an already selected outcome, and does not emit another deletion transition when retried.
- Tool work remains open through permission, around/after hooks, plugin processing, and result replay. Ownership is checked at the tool-body boundary. A takeover marks abandoned running work unknown; the stale owner cannot finish it and the new fenced owner must explicitly reconcile it before completion. Unknown mutating work blocks a new root prompt, but stale root invocations with no such work are closed by the next atomic bind. A rejected bind leaves only a terminal `failed/recovery_required` execution, and synthetic review continuation binding closes the prior invocation without leaving the execution budget.
- Child, workflow, taskflow-plan, and verification obligations are durable blockers. Only resolved blockers or an authorized, reasoned waiver satisfy the success gate; clearing a visual task list does not silently resolve work.
- Owner leases are renewed by a shared execution-lifetime controller while root, child, model, review, or tool work holds the execution. Persistent cancellation or lease loss aborts the shared signal. Rejected-review retries use a bounded persistent continuation outbox so a crash between the ledger decision and session projection cannot lose the retry or create a fresh budget scope.
- Tool work is admitted persistently after permission but before invocation. Mutating tool admission dirties the revision before any side effect; duplicate operation IDs are rejected, and running or unknown operations block final staging/commit instead of being guessed complete after restart.
- Session-bound verification, retry/fallback, review, compaction, and memory calls consume the same ledger. Background memory work runs after the main response so it cannot take the first reservation.
- Automatic prompt memory recall uses BM25 ordering without a model request per tool step. Explicit memory search can use reranking; its five-second request deadline aborts the model request, disables SDK retries, and propagates execution cancellation. Failure retains BM25 order.

Treat permission changes as security-sensitive and cover them with focused tests.
Common Bash filesystem operands and redirection destinations receive external-directory checks before execution, separately from command permission. All request patterns are checked for denial before one-time approval; `once` never authorizes later calls. Static path checks are not an OS sandbox and do not prove containment for arbitrary expansions, interpreters, symlinks, or subprocesses. See `docs/SESSION-WORKSPACE-AUDIT.md` for source-backed evidence and test coverage.

Live agent comparisons use the same versioned eval fixtures with `eval benchmark --execute --routing fixed-base|fixed-expert|adaptive`; fixed-expert requires `--expert-model`. Benchmark token and tool totals span every model used in the same turn; the recorded model ID identifies the final responder. The last observed test run supplies the test-pass signal while hidden verifiers determine case correctness. Reports distinguish calls, expert episodes, unpriced calls, TTFT/total time, proposals/rejections/repeated questions, and returns to base. These runs consume provider quota, and fixture-backed harness tests are not live model verification.
For before/after claims, use separate clean revisions, identical versioned cases and model settings, alternating repeated runs, and raw run IDs. Report verifier outcomes, duration, tokens, known cost, unpriced calls, and rate-limit failures per case; see `AtomBase/evals/README.md` for the comparison protocol.

## TUI development

- The TUI uses SolidJS through `@opentui/solid`.
- Components live under `AtomBase/src/interfaces/cli/cmd/tui/`.
- Use the `@tui/*` alias for TUI imports.
- Do not import TUI modules into contexts that are not built with `--conditions=browser`.
- Preserve responsive behavior for short/narrow terminals and add layout tests for boundary sizes.

Run the TUI from `AtomBase/` with `bun run dev` or the explicit browser-condition command.

## Server and SDK contract

Any server API route change under `AtomBase/src/server/` requires JavaScript SDK regeneration:

```sh
cd AtomBase
bun run dev generate > ../libs/sdk/js/openapi.json
cd ../libs/sdk/js
bun run build
```

Never manually edit `libs/sdk/js/src/v2/gen/`; it is generated output. After regeneration, confirm the generated client is stable and review the OpenAPI diff.

Before finishing a server API change, CI expects generated sources to be clean after regeneration:

```sh
git diff --exit-code -- libs/sdk/js/src/v2/gen
```

Listener implementation changes that do not alter routes or the OpenAPI contract do not require SDK regeneration, but still require server-focused tests.

Server security invariants:

- Default control-plane port is 4096 with available-port fallback.
- Non-loopback control-plane binds require authentication.
- CORS is restricted to allowed localhost, Tauri, AtomCLI, and configured origins.
- Keep `globalThis.AI_SDK_LOG_WARNINGS = false` in `server.ts` so the `ai` package does not corrupt stdout protocols.

## Companion package and app

Companion work may span two packages:

- `libs/companion/`: TypeScript bridge, discovery, authentication, replay, and pairing.
- `companion/`: Flutter mobile UI, background service, preferences, notifications, and WebSocket client.

The Zod schemas in `libs/companion/src/protocol.ts` are the Companion wire-contract source of truth. After changing them, run `bun run protocol:generate` and `bun run protocol:check` from `libs/companion/`; do not hand-edit the generated Dart handshake file or JSON Schema.

For bridge/server changes, run the relevant Bun tests in AtomBase and `libs/companion`. For Flutter changes:

```sh
cd companion
flutter pub get
flutter analyze
flutter test
flutter build apk --debug
```

Before device testing:

```sh
adb devices
flutter devices
flutter run -d <device-id>
```

For repeatable Android integration, boot an emulator and run `python3 tool/test_android_integration.py --device <adb-serial>` from `companion/`. It drives the real app against two isolated AtomCLI processes with scripted model responses, using a separate debug-only `.e2e` application ID. Each run resets only that test package. Cancellation must leave the server alive and reject late completion; the SDK text getter produces a new promise per read, so attach result observation to a single captured promise. The runner retains logs and server evidence outside the repository, removes its port mappings and stops its servers. See `companion/README.md` for coverage and output options. Run the Flutter tests, Companion server tests and bridge/protocol checks as separate acceptance layers. Device integration does not prove live model quality, physical QR scanning, LAN/Tailscale handoff, OEM notifications, Doze behavior or iOS support; Companion remains beta.

Exercise QR pairing, LAN/Tailscale fallback, reconnect, permission decisions, background notifications, uploads/downloads, previews, session/model restoration, and device revocation in proportion to the changed area.

Keep multiple-process behavior explicit: automatic companion listeners may select different ports; an explicitly configured companion port must fail on collision instead of silently moving a stored endpoint.

## Build behavior

From `AtomBase/`:

```sh
bun run build
```

The build script deletes `AtomBase/dist/` before every build. Never store source, release notes, or irreplaceable artifacts there. Alpine runtimes for musl builds require `libstdc++` and `libgcc`; the release installer and platform smoke workflow install both packages.

The build tree includes tracked `.atomcli/` and `.claude/` assets. Published releases package bundled skills in a checksum-covered archive that installers place in the global skills directory. Before adding a bundled asset:

- ensure it is intentional, portable, and free of credentials;
- include only instruction assets required at runtime;
- keep package manifests, locks, dependencies, inbox files, logs, plans, runs, and session state ignored;
- never force-add ignored runtime content.

## Session pipeline invariants

- A compaction summary cuts off older model context only after its transaction commits. Empty, whitespace-only, unfinished, or non-shrinking summaries are rejected.
- Compaction control messages continue the current execution, preserving its objective, plan, and consumed allowance; they must not cancel it or start a new root invocation.
- Completed tool evidence stays in model history if a provider error arrives later in the same turn. Replay distinguishes a tool execution failure from a post-processing failure after the operation was applied; do not automatically repeat the latter.
- Plain-text data URL attachments decode only their payload. Base64 and percent-encoded UTF-8 are accepted, malformed encodings are rejected, and decoded text is capped at 1 MiB.

## Documentation and bundled guide maintenance

User-visible behavior changes include documentation work in their definition of done. Keep these layers synchronized:

| Topic                  | Canonical document                                       | Bundled reference            |
| ---------------------- | -------------------------------------------------------- | ---------------------------- |
| Overview and first run | `README.md`                                              | `getting-started-and-tui.md` |
| Configuration          | schema-owning docs                                       | `configuration.md`           |
| Providers and models   | `docs/PROVIDERS.md`                                      | `providers-and-models.md`    |
| Extensions and MCP     | `docs/SKILLS-GUIDE.md` / `docs/MCP-GUIDE.md`             | `extensions.md`              |
| Server and Companion   | `companion/README.md` and server docs                    | `server-and-companion.md`    |
| Contributor workflow   | `AGENTS.md`, `AtomBase/AGENTS.md`, `docs/DEVELOPMENT.md` | this file                    |

Keep the root `SKILL.md` a concise router and put detail in the relevant reference. Do not duplicate unstable provider catalogs, version numbers, or dynamically assigned ports. Validate examples against current CLI help and config against `Config.Info`.

After changing `atomcli-guide`:

```sh
cd AtomBase
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json bun test test/skill/atomcli-guide.test.ts
bun run --conditions=browser ./src/index.ts skill list
bun run --conditions=browser ./src/index.ts skill show atomcli-guide
```

Do not update release notes or version metadata unless release preparation was explicitly requested.

## Git and release hygiene

Do not commit credentials, configuration generated for one machine, dependencies, logs, test sandboxes, transcripts, generated binaries, or release staging directories.

Before a release, inspect:

```sh
git status --short
git status --short --ignored
git ls-files -ci --exclude-standard
```

The last command must produce no output: tracked files must not also be ignored.

Releases are triggered only by `v*` Git tags. Do not push commits or tags, publish packages, or create a release unless the user explicitly authorizes that exact action. When authorized:

- run the documented validation commands;
- ensure `RELEASE_NOTES.md` matches the package version and contains no emoji;
- push only the exact intended version tag;
- never substitute `git push --tags`;
- do not manually push `AtomBase/dist/` or `release_assets/`.

The tag workflow also analyzes and tests the Flutter Companion, then attaches a signed `atomcli-companion-android.apk` to the checksum-covered release assets. Published APKs require the persistent repository secrets `ATOMCLI_ANDROID_KEYSTORE_BASE64`, `ATOMCLI_ANDROID_KEYSTORE_PASSWORD`, `ATOMCLI_ANDROID_KEY_ALIAS`, and `ATOMCLI_ANDROID_KEY_PASSWORD`; the workflow must fail rather than publish a debug-signed APK when they are absent. Local debug-key release builds are for device testing only. Never commit an Android keystore or its passwords. Every tag builds a fresh APK and verifies that its manifest version matches the release version; an older release APK is never substituted.

## Definition of done

Prompt-loop orchestration stays in `AtomBase/src/core/session/prompt.ts`. Pure context/checkpoint shaping lives in `AtomBase/src/core/session/prompt/context.ts`; turn preparation, persistence, processor creation, tool resolution, and execution side effects live in `AtomBase/src/core/session/prompt/turn-execution.ts`. Shaping helpers must not import the prompt loop or hold session state.

For an ordinary AtomBase change:

1. `bun run typecheck` passes from `AtomBase/`.
2. Focused regression tests pass with the models fixture when provider code may load.
3. The full AtomBase suite passes, or root `bun turbo test` passes for cross-package changes.
4. Formatting and `git diff --check` pass.
5. Generated SDK state is correct if the server API changed.
6. `git status --short` contains only intended files.
7. Canonical docs and the matching bundled guide reference reflect user-visible behavior.
8. The handoff reports what changed, what was validated, and any unresolved failure without claiming success prematurely.

Checkpoint prose containing “complete” cannot turn `continue` into `finish`. Bash result evidence proves progress, not acceptance. Acceptance PASS is bound to successful current-review tool calls, every original criterion, and the immutable request hash; legacy QA PASS cannot satisfy changed criteria. Browser smoke checks likewise do not prove gameplay: map each acceptance criterion to setup, action, expected result, and observed evidence. Names, text matches, screenshots alone, and builds do not prove behavior. Verify 3D from coordinates, projection, depth/occlusion, camera, and spatial interaction; preserve explicit WebGL/engine requirements. Keep single-file source indented with clear HTML/CSS/JS sections, use an installed formatter when suitable, and recheck behavior.

Enabled formatters run on created and edited files; `write` and `edit` wait for them. Edit hashes/diffs use the formatted content. Formatter failure reports an applied write with failed post-processing: inspect before retrying. Global/per-formatter disabling is respected. Bash-created files still need an explicit formatter command when suitable. Readable HTML/CSS/JS is quality advice; compression alone does not block completion unless the user explicitly requires formatting.

Compaction retains bounded skill source/range/pending history, visibly reports shortening, and may require reloading bodies. Every work turn restores the durable root objective and checkpoint reason; summaries preserve exact constraints, unresolved work, and verification limits. History shortening does not itself prevent checkpoint generation. Child task panels follow ancestor execution snapshots when their own snapshot is empty; completed steps remain complete while overall execution can be blocked.

Browser flows preserve earlier step observations on known failure. Completed assertion/JavaScript errors and locator preflight failures settle failed with no PASS evidence; transport loss/cancellation and uncertain mutations retain unknown work. Earlier steps stay applied. Mouse down/up can use the current pointer position.

### Evidence-backed completion

Share synchronization resolves message models only when the session has a share record. Unshared history with an unavailable model does not trigger provider resolution; corrupt share records remain errors.

Run verification checks separately, selecting their directory with Bash `workdir`. Recovery lists the checks inside ambiguous compound calls; trailing diagnostics cannot certify or permanently poison a test result. Rerun the same full scope independently. Bun reporter changes preserve that scope; different environment assignments remain separate.

Benchmark execution records retain created session IDs even when setup fails or the case times out.

An unfinished checkpoint cannot become successful completion without new work merely because classification omitted acceptance criteria. Raw tool-protocol output is rejected and never executed as text. Recovery is bounded; exhaustion reports a non-success result.

Checkpoint `checks` optionally references separate Bash calls with `{name, callID}`. Runtime derives PASS/FAIL/BLOCKED from real execution metadata and current source fingerprints. Compound commands cannot establish independent subchecks; changed source invalidates old PASS. `completedWork` without these references is self-reported. Consult `docs/DEVELOPMENT.md` for the verification and isolated benchmark workflow.

For configuration/auth troubleshooting, use `scope_control status`: it reports actual runtime paths and safe provider-source diagnostics. Missing legacy paths or environment variables do not establish missing credentials. Access stays unverified until a real provider operation supplies evidence; never print config/auth contents.

Coverage stays enabled with the native LCOV reporter at `AtomBase/coverage/lcov.info` (ignored), avoiding Bun 1.3.14 text coverage `WriteFailed` under Turbo. Assertions, skips and timeouts are unchanged.

Filesystem tools accept workspace-relative paths where documented; prefer them for local targets instead of rebuilding long absolute roots. Read reports its current workspace after a missing target; use `find` there to discover the exact file. A denied external path does not deny permitted discovery inside the workspace. Paths are never silently redirected, and permission checks remain binding.

Benchmark suite version 3 parses resumed records as JSON and checks every record's ID, name, email and numeric `schemaVersion: 2`, retaining completed-file hash checks. This replaces the whitespace-sensitive version 2 grep. Historical version 2 scores remain unchanged; cross-version results are not a controlled before/after comparison.

Evaluation counts a call routed to the `invalid` tool as a tool error even when that diagnostic tool has a completed status. Invalid arguments and unavailable tools cannot appear as zero-error execution. Existing error budgets remain unchanged.

An invalid-call diagnostic states that no action was applied and asks for corrected arguments. It does not label an available tool as unavailable solely because argument parsing failed, or suggest ending the task with text instead of repairing the call.

Suite version 4 replaces coordination prose keyword grading with an explicit authoritative JSON block in `VERDICT.md`. The public prompt specifies every required field: full-log metric/value/population/sample size/nearest-rank position, accepted and rejected source paths, the rejected source's stated value/sample size and whether that claim applies to the full log. Free prose has no synonym requirement. Verification independently recomputes p99 and checks the JSON types and values; setup hashes protect both evidence files and the raw log. A prose mention of the right number cannot rescue an incorrect structured verdict. Historical version 2/3 results retain their original scores; version 4 changes one task's output contract and is not a controlled comparison with them. Tool-error/retry budgets and timeouts are unchanged.

Suite version 5 uses `grading: "outcome-v2"`: verified successful final work passes despite recovered tool errors or retries. Above the existing allowances, each tool error costs 2 points (cap 10), each retry 1 point (cap 5); exceeding the soft `maxDurationMs` target costs `min(5, ceil((durationMs / maxDurationMs - 1) * 5))`. A passing case scores 80–100; failed/unobserved cases score 0. Aggregate `score` averages all cases; `accepted` requires every case to pass and controls live CLI exit, while `ready` only indicates observation coverage. Missing/failed independent verification, unsuccessful/incomplete execution, missing required tools, failed required tests and the hard `timeoutMs` watchdog remain blocking. Two excess tool errors with correct verified output therefore pass at 96/100. Custom suites default to historical `strict-v1`; opt in explicitly. Policy buckets are separate; old grades remain intact. Prompts, fixtures, verifier assertions, allowances and timeouts are unchanged. A grading change alone is not a model-quality improvement. See `AtomBase/evals/README.md` for report semantics.

Browser integration fixtures explicitly focus the page before requesting pointer lock and bound both acquisition and release waits. Browser tools restore desktop focus; a background document cannot be assumed eligible for pointer lock. CI installs the pinned Chromium runtime and runs the opt-in browser suite explicitly. Android integration uses a 20-minute Flutter build/start/test ceiling and retains verbose Flutter output plus native crash/runtime logs; setup hangs are failures, not passed scenarios. CI uses the same SwiftShader backend as the validated local emulator.

Linux CI and release jobs run `.github/scripts/setup-linux-sandbox.sh` before tests. On Ubuntu with restricted unprivileged user namespaces, it grants the installed bubblewrap launcher an explicit AppArmor user-namespace policy, preserving the host-wide restriction. An actual unprivileged UID/PID namespace probe must pass; sandbox tests and product enforcement are never bypassed.

Workflow drafts are saved before acknowledging planning; restart reloads by ID. Revision clears stale projected output, preserves ledger evidence, and sends bounded escaped rejection feedback to the next worker. Review success clears review scope; blocked review retains edit evidence and concrete rejection budgets, clears terminal reviewer bindings. Deleting sessions clears descendant harness/QA state; deleted-child edits move to the surviving parent. `/review` still uses the internal Task command adapter; it shares the scheduler and is not another advertised tool. See `docs/DEVELOPMENT.md` for ledger status and recovery behavior.

Workflow scheduler states are conservative ledger projections. Status responses and live events retain `ledgerState.status/reason`; the TUI distinguishes review waiting, blocked work and lost ownership. See the ledger task state projection table in `docs/DEVELOPMENT.md` for the mapping and revision-feedback rules.
