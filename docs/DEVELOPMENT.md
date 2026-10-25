# Development Guide

## Requirements

- Bun 1.3.14
- Git

Use Bun only; this repository does not use npm or Yarn. The monorepo root delegates workspace tasks, while the primary application package is `AtomBase/`.

Share synchronization resolves message models only for sessions with an existing share record. Unshared history can retain unavailable model IDs without triggering a provider lookup; malformed share records still report errors.

Run verification commands in separate Bash calls using `workdir`. Compound exit codes cannot independently establish test results; completion recovery requests the extracted checks rather than unrelated diagnostic commands. A successful compound cannot mask a test failure. Bun reporter changes preserve the same test scope; environment assignment changes do not.

Benchmark execution reports retain created session IDs for failed setup and timeout cases as well as completed cases.

## Repository layout

| Location                   | Purpose                                                                           |
| -------------------------- | --------------------------------------------------------------------------------- |
| `AtomBase/`                | CLI, TUI, server, providers, tools, sessions, and configuration                   |
| `libs/sdk/js/`             | Generated JavaScript/TypeScript SDK                                               |
| `libs/companion/`          | Companion pairing, mobile bridge, and discovery library                           |
| `companion/`               | Flutter companion application                                                     |
| `.atomcli/` and `.claude/` | Tracked skills and agents copied into release artifacts; includes `atomcli-guide` |
| `docs/`                    | Maintained user and developer documentation                                       |

## Run locally

```sh
cd AtomBase
bun run dev
```

Alternatively, `bun run dev` from the monorepo root preserves the root as the active project while loading the CLI from `AtomBase/`. The development command runs with Bun's `browser` condition, which is required for TUI imports. To inspect commands without starting an interactive workflow:

Normal TUI startup does not open a redundant loopback control-plane listener; its RPC transport serves the local UI and the Companion listener gets first use of port 4096. Explicit control-plane network options still start that listener and may cause an automatic Companion listener to select another available port.

```sh
bun run --conditions=browser ./src/index.ts --help
```

## Validation

Run package checks from `AtomBase/`:

```sh
bun run typecheck
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json bun test
```

Run workspace checks from the repository root:

```sh
bun turbo typecheck
bun turbo test
```

The models.dev fixture is the required test convention. `test/preload.ts` copies that fixture into the isolated test data directory, so the standard test suite does not require a live models.dev request.

Bun 1.3.14 resets `setDefaultTimeout` between test files, even when it ran in preload; the configured `test.timeout` does not prevent this reset. Integration files that spawn real Git or test processes must set their bounded timeout locally, as `test/tool/atomic-work.test.ts` does.

Scripted PTY fixtures reuse installed workspace dependencies and disable downloaded auth plugins, including during session resume. Live `pty-smoke.py --home ...` runs retain normal plugin loading.

Prefer behavior-level tests over implementation-only assertions. A regression test should exercise the public boundary that failed, use an isolated temporary project when filesystem or Git state matters, and assert an observable result. Provider unit tests may mock transport, but live provider probes must remain explicitly opt-in and must distinguish rate limits from compatibility failures.

Session prompt orchestration remains in `AtomBase/src/core/session/prompt.ts`. Pure context/checkpoint shaping stays in `AtomBase/src/core/session/prompt/context.ts`; turn preparation, persistence, processor creation, tool resolution, and execution side effects live in `AtomBase/src/core/session/prompt/turn-execution.ts`. Keep this boundary one-way: shaping helpers must not import the prompt loop or hold session state.

Bun coverage remains enabled and writes `AtomBase/coverage/lcov.info` (ignored). The native LCOV reporter avoids Bun 1.3.14's `WriteFailed` in the large text coverage table when output is piped through Turbo; test assertions, skip rules and timeouts are unchanged.

### Dependency security updates

Run `bun audit` from the repository root. Update dependencies in small groups, recording the affected manifests,
lockfile, runtime surfaces, audit results, and focused tests before and after each group. Use
`bun turbo test --force` when a fresh full-suite run is required; a Turbo cache hit replays an earlier result.

Root `package.json` overrides keep patched transitive dependencies consistent, including the single SolidJS runtime
used by OpenTUI. Verify rendering and real PTY behavior after changing SolidJS, image decoding after changing Jimp,
and provider/MCP transport behavior after changing HTTP or authentication dependencies. Do not force a newer major
version into a transitive dependency without testing the consuming package's API.

The gray-matter patch adapts its YAML engine to js-yaml's current `load`/`dump` API. This lets the workspace use
patched js-yaml without retaining the old argparse/sprintf-js dependency chain. Keep frontmatter parsing, agent
metadata round-trips, and rejection of executable YAML covered. Remove the patch when upstream provides this
compatibility. js-yaml 4 follows YAML 1.2 numeric parsing: use explicit `0o` prefixes for octal values.

After the focused checks pass, run workspace typechecks, the full suite, SDK generation, a frozen-lockfile install,
and `bun audit` again. Record any remaining advisory and its actual exposure; do not suppress it to make the report
green. Binary build output remains ignored and must not be committed.

The workspace uses Zod 4.6.7, body-parser 2.4.0, and fast-uri 3.1.9 for their security fixes. `bun audit` still reports GHSA-mrhx-c7xc-m3w5 for transitive Zod 3.25.76 copies required by ACP and Jimp. No patched Zod 3 release is available; do not force Zod 4 into those consumers or suppress the advisory. Recheck when upstream dependencies support a patched version.

### Workspace result verification

Creating a directory does not change Bash's working directory. Each Bash call starts a new shell; use `workdir` and absolute `write`/`edit` targets. A package-manager test can pass using an ancestor's `package.json`, so verify the requested file locations separately from the exit code.

Completion checks explicit inline-code directory targets in English creation instructions (`in`, `inside`, `under`) and Turkish instructions (`klasöründe`, `dizininde`, `içinde`) against actual deliverable files. Missing files cause a bounded repair continuation, or a terminal non-success report when repair is unavailable. Checkpoint `Remaining`/`Blockers` remains advisory; arbitrary model prose is not a durable gate. For an execution with an explicit acceptance contract, a structured `continue` checkpoint with remaining work cannot become successful completion without any subsequent tools: the existing repair continuation resumes work. Later tools or a `finish` assessment supersede that unchanged assessment; they do not independently certify product quality. This targeted path check is not a general natural-language acceptance verifier; broader goals need explicit task acceptance checks. Reviewer use remains optional.

Bash checks statically visible path operands for common filesystem commands and file redirections before spawning. Command authorization and external-directory authorization are separate; an allowed Bash command does not authorize external reads or writes. Every requested pattern is checked for explicit denial before offering one-time approval. `once` resolves only the pending request, never later calls. These checks are not an OS sandbox: expansion, scripts, interpreters, symlinks, and subprocess behavior still require appropriate command rules and execution isolation.

Config `agent_mode="autonomous"` applies only to the current project; loading another project's config does not grant autonomous permissions. Process-level YOLO flags still apply across projects. External-directory requests pass through permission evaluation in either mode, so explicit denials remain enforced.

Bash timeout is a hard deadline, not an asynchronous yield: expiry terminates the command and returns 124; cancellation returns 130. Persistent local test servers require detached execution with redirected stdio and a readiness check. A shell that exited successfully while a background child still holds captured output open does not make the timed-out tool successful. Harness logs use the same status. Interrupted commands with write effects retain unknown work until reconciled; termination does not prove their side effects were rolled back.

Changed JS, TS, JSX and HTML files are checked automatically before child QA/patch merge, when durable task acceptance is recorded, during artifact recovery, and before root completion. The `static_check` tool is also advertised in focused/coordinated scopes; it is a native tool, not a shell command. A failed automatic gate prevents acceptance/completion even when optional review is disabled. It runs once per verification boundary, not after every edit. Command-based build/test acceptance remains separate.

Recognized native Bash build commands record a hash snapshot of tracked edited inputs before spawning. Root completion compares the latest snapshot for each build command/workdir with current tracked files, including newly added files. A source change requires rebuilding before success. This covers standard Bun build commands and common package-manager/Cargo/Go build forms; custom scripts, inputs outside the workdir, untracked external changes, and artifact-only tampering require explicit project acceptance checks. It does not infer an arbitrary build dependency graph or require a build for standalone HTML.

TUI shutdown cancels executions still owned by its worker, including idle waits whose lease expired. The stored owner and fence must still match; a replacement process's execution is preserved. Ordinary cancellation retains lease validation. Ctrl+C on a nonempty draft consumes the key while clearing input; an empty prompt opens exit confirmation.

Plugin event subscriptions retain their initialized hooks for the instance lifetime. Publishing the final disposal event does not initialize plugin/config state again.

Bun's native transpiler validates syntax and removes TS types/JSX before symbol analysis. The existing heuristic gate reports `no-undef` and redeclarations, including inline HTML scripts and minified code. It is not a complete type checker or proof of runtime behavior: template interpolation and project-wide ambient globals need stronger project checks; TS/JSX locations refer to emitted JS. Inline HTML syntax and symbol diagnostics point to their original HTML line and column, including across multiple scripts. Unsupported files and deleted sources are skipped; other read errors and files over 20 MiB block verification. Results include a source SHA-256 in bounded harness logs. Files are rechecked after later changes; old results cannot exempt a new completion. See `test/verification/static-gate.test.ts`, `test/execution/task-verification.test.ts` and `test/session/prompt-completion-recovery.test.ts`.

`read` preserves long source lines within its existing 50 KiB budget; `grep` preserves captured matching lines within its existing capture/output limits. Neither silently hides a match after character 2000. Oversized reads report truncation, preserve UTF-8 boundaries, and derive edit anchors from the original source. Content hashes and stale-edit checks remain authoritative. A line offset advances to another line; it cannot resume inside an oversized line.

Native execution reuses its existing trusted Read/own-write revision record when Edit omits `contentHash`. Explicit hashes still reject mismatches; they are never corrected silently. Native Write advances the same revision record and checks known source hashes before overwriting, including external changes whose mtime was restored. Existing permission, lock, post-permission freshness and anchor checks remain in force. Legacy callers without execution revision evidence retain the read-time protocol.

Native model Edit schemas expose text replacements and atomic batches, without hash or range-anchor parameters: freshness belongs to the existing execution revision record. Put every replacement in `operations` when using a batch; mixing it with nonempty top-level replacement fields rejects the whole request before writing. Empty provider-generated top-level strings and an empty `operations` array retain their existing behavior. Direct integrations retain optional explicit hashes and anchors, with unchanged mismatch rejection. Stale-edit recovery requests current source and an exact unique replacement; add surrounding text for repeated matches. For direct scoped calls, Read's end anchor hashes the entire returned range, not an independently chosen line.

Workflow `isolation="auto"` uses Git worktrees when available, otherwise the existing shared-workspace ownership and permission guards. `isolation="required"` rejects a non-Git workspace during planning, before workflow/task/blocker creation or child dispatch; it is never silently downgraded. Execute retains its isolation check for persisted plans and workspace changes.

Child `agent_result` fields use the shared `WorkflowBlackboard.StructuredResult` schema. `facts` and `decisions` accept strings or `{ key?, value, evidence? }` objects; `tests`, `failures`, `constraints`, `openQuestions`, and `editedFiles` contain strings only. Record non-blocking editor diagnostics in `facts` or `constraints`; genuine incomplete work stays in `failures` and cannot be accepted. Invalid result formats receive field-specific errors and report-only correction feedback within the existing task `maxRetries` budget, in the same child session. `maxRetries: 0` allows no correction attempt. File/test success alone never accepts a malformed or incomplete report. A legacy workflow coding task with explicit owned paths must supply this report even if its attempted edits failed or no change was necessary; zero edits cannot silently classify the assignment as a completed read-only inspection. Atomic Work retains its authoritative durable task acceptance instead of requiring a second legacy report solely because it owns files.

### Negative workflow tests and root reports

An expected timeout remains a failed child invocation/task/workflow. Once required artifact and parent test checks establish the result, the root can publish a durable `blocked` report without recovering, waiving, or accepting the failed work. Unknown mutating effects remain unresolved and continue to prevent successful completion; provider accounting marked `uncertain` is separate from work state. A terminal report does not certify those effects as safe.

`agent(action="workflow", workflow_action="status", workflowId=...)` exposes the root execution view, durable task outcomes and child invocation timestamps/cancellation reasons alongside workflow status. Use these public facts for ordinary reports; report missing provider-attempt or forensic details as unverified unless explicitly required. A root still running cannot observe its future terminal state. After a failed workflow, varying read-only observations does not reset the no-progress counter; actual artifact revisions, plan changes and browser verification still count. Root `finish` and `continue` checkpoints with failed obligations become `blocked` without another work grant. Report-only checkpoints and model-call/step budget failures produce visible non-success reports, using a deterministic fallback when no usable model text exists.

### Storage cutover and recovery

For a changed browser deliverable or an explicit browser runtime verification task, the mechanical completion gate requires a successful browser navigation or reload and a browser visual or behavior check (`screenshot`, `assert`, `input_sequence`, or `evaluate`) after the latest source edit. Existing-site inspection/operation contracts that explicitly request accessibility or network inspection can instead supply those successful inspections; every requested inspection remains required, and screenshot/visual/game/input requirements still need visual or behavior evidence. Explicit browser-tool, flow, navigation, verification, Playwright and input_sequence requests retain browser capability during read-only classification and fallback; a second matching action keyword is unnecessary. Making no source edits does not waive required runtime verification. Browser navigation accepts HTTP(S); serve local artifacts from the parent workspace. Invalid URL preflight is recorded as not applied. Missing or foreign child-session targets rejected before agent dispatch are also not applied, so they cannot create uncertain mutating work. These checks are smoke evidence, not proof of every acceptance criterion. Reviewer guidance maps each criterion to setup, action, expected result, and observed evidence; names, text presence, screenshots alone, and builds do not prove gameplay. Canvas 2D alone neither proves nor disproves 3D: verify projection, depth, camera, and spatial interaction, preserving explicit renderer requirements. The bounded 3D contract derivation excludes explicit English negations such as `without WebGL` and `WebGL is not required`; merely naming an excluded renderer cannot add a renderer or 3D requirement. Readable single-file formatting is advice, not a completion gate; explicit user formatting requirements still belong to acceptance. Browser checks count as checkpoint progress; repeated identical calls still trigger the loop guard. Work stopped at its step limit with verification pending is blocked, not completed.

The `accessibility` action returns its ARIA tree plus a bounded check of the first 100 native form controls for missing associated or non-empty ARIA/title labels. Placeholder-only fields are flagged as potential issues. Hidden controls and non-field input types are excluded. Custom controls, frames, visual contrast and complete accessibility conformance require separate checks.

Successful browser flows count their navigation and verification steps. A result at `about:blank` records the successful tool operation and its cost, but supplies no artifact navigation, verification, or checkpoint progress evidence. Browser interaction and saved verification assets do not invalidate source verification evidence. Saved screenshots, downloads and traces retain filesystem ownership enforcement, including inside flows: an owned child uses `screenshot(save=false)` or delegates file saving to the parent. Browser permissions and external-directory checks remain enforced. A direct navigation rejected with Chromium's `ERR_CONNECTION_REFUSED` is recorded as not applied. Known completed failures inside flows preserve earlier steps and report failed status; transport loss, cancellation and partially applied failed navigation remain uncertain. A settled click timeout whose last input attempt was intercepted is failed without PASS evidence; Playwright logs “performing click action” before its event interceptor resolves. An unmatched input attempt, completed click waiting on navigation, transport loss or cancellation remains uncertain.

Browser evidence is invalidated by later write-effect tools, including arbitrary Bash verification scripts. A native edit/write of an exact contract-declared, regular, unlinked `.md`/`.txt` findings deliverable in an `inspect`/`operate` task preserves site evidence; undeclared paths, application changes and unknown shell effects do not receive this exemption. Changing acceptance clears all browser inspection evidence. A parallel Bash check that finishes after navigation can therefore require fresh navigation even when no native `edit` followed it. The completion diagnostic names this distinction; a shell command's successful exit does not prove that unrelated files, dependencies, or server state were unchanged.

File discovery respects Git/default ignore rules. Tree mode also shows omitted immediate directory names without exposing their contents; `ignore: []` adds no filters but does not disable existing ones. Use pattern mode with the exact omitted directory and `pattern: "*"`, or read its exact file path under normal permissions. Start from an existing directory, follow local README paths, and never append `/..` to a file path. Model-facing edit schemas expose only a required nonempty `operations` array, even for one replacement. Native callers and persisted legacy calls retain top-level `oldString/newString` support; mixed requests remain rejected without writes and receive schema-specific repair advice. No union schema or implicit choice between conflicting edits is introduced. Missing `.json` filenames receive discovery repair advice; only actual JSON parsing/validation errors receive schema advice.

Real-time games continue between tool calls. Keep reset/start, input and observations in one browser `flow` (at most 20 steps). `wait(duration)` waits real milliseconds with cancellation; a target plus `text` waits for matching text (`exact` matches literally). A delay plus a condition checks the condition after the delay.

For a state-dependent physical move, use `key_down`, a bounded observation, then `key_up` in that flow. Asynchronous `evaluate` awaits a Promise and can inspect existing game telemetry; include a deadline in the script. `wait` does not execute `script`. Failed/aborted flows release keys acquired through their `key_down` steps, on the page where each key was held. Successful flows preserve intentional cross-call holds. This extends existing input-sequence cleanup to the flow boundary without adding an evaluation permission bypass.

The existing formatter service handles both created and edited files. `write` and `edit` wait for enabled formatters before returning; edit hashes and diffs describe the formatted content. A formatter failure reports that the write was applied but post-processing failed, so the agent must inspect the file instead of blindly repeating the mutation. `formatter: false` and per-formatter disabling remain respected. Files produced through Bash need an explicit formatter command when suitable; automatic formatting is not a universal readability check.

Session history follows the active directory even when multiple directories share one Git project ID. `Session.list()` and the session API show only records for that directory; opening another directory's session ID returns 404. `Session.list({ directory: null })` is reserved for intentional project-wide reads.

Confirming TUI exit cancels this worker's owned executions through their current fences before disposing instances. Other processes' executions are unaffected. Generic instance disposal/reload remains separate from user cancellation. A real Python-stdlib PTY regression (`test/cli/tui/pty-smoke.py`) drives typed prompt submission, resizing, session navigation, multiline input and exit against a local scripted provider, including an intentionally stalled stream. It waits for the prompt, sends bracketed paste and Enter as separate terminal inputs, and requires a durable execution record, not just echoed prompt text. This tests the TUI and durable shutdown state; it does not represent live model quality.

The static `/session/status` endpoint remains available during prompt execution. TUI status bootstrap treats a failed response as an empty map, and status events can restore a missing store branch without crashing the interface.

AtomCLI storage uses a SQLite/WAL manifest whose revisions point at immutable, content-addressed JSON blobs. `Storage.update` uses bounded compare-and-swap retries, so two current AtomCLI processes cannot silently overwrite the same read-modify-write operation. Reads validate their cached revision against the manifest; deletes leave a tombstone, preventing old JSON files or stale caches from recreating a deleted record.

Session records have a durable generation guard. Creating or importing a session activates its generation; deletion first increments and tombstones that generation, then abandons pending completion projections and purges transcript namespaces. Message and part writes and removals validate the generation in the same manifest transaction, so a late stream or projector callback cannot recreate or mutate deleted content. Projection recovery treats an existing tombstone as an idempotent abandonment and scans committed deliveries in bounded pages of 50 instead of failing when more than 100 are waiting. Accounting may remain in the execution ledger, but deleted transcript payloads are not restored from it.

Before the first manifest cutover, AtomCLI creates and verifies `~/.atomcli/data/storage-backups/cutover-v1`. This backup contains the original JSON records and a SHA-256 manifest; credentials outside the storage tree are not included. Corrupt legacy JSON is retained byte-for-byte for recovery and appears as an unreadable record instead of being discarded. Restore tooling must run `StorageBackup.restore(..., dryRun: true)` first and restore into an empty destination; publication occurs through a verified staging directory so an interrupted copy does not replace the destination.

An interrupted cutover does not rescan and hash the entire legacy tree during every startup. Existing manifest keys open immediately; missing legacy records and list prefixes are imported on demand. A new cutover records completion only after the full initial import, so a crash cannot hide records and tombstones still take precedence over legacy files.

Use `test/core/storage-manifest.test.ts`, `test/core/storage-backup.test.ts`, and `test/core/storage-migration.test.ts` when changing this boundary. The manifest format check intentionally rejects a database written by a newer AtomCLI binary.

### Automatic data retention

Snapshot capture has a **global 1024 MiB object budget**, shared across projects and processes. At the budget, new captures stop with a warning; existing rollback trees are preserved. Files over 2 MiB and local runtime/dependency directories are excluded. Project Git ignore rules select the remaining files; no media-extension blacklist is used. A capture also stops before staging a tree over 64 MiB or 10,000 files. Excluded files have no snapshot rollback. Original project files and the project's Git index are never changed by capture.

Full model-request and duplicate tool-event replay payloads are **off by default** (`retention.replay: false`). Chat messages, normal tool results, execution accounting and checkpoints still persist. Explicit replay APIs remain available; maintenance discards old full request copies while replay is disabled; opt-in replay diagnostics expire after seven days. This does not provide indefinite forensic replay.

Live record writes have a fixed **2 GiB admission ceiling**, conservatively counting payload bytes plus 4 KiB per pointer. SQLite tracks usage atomically across processes. A write that grows beyond the ceiling fails before preparing its payload; existing data, deletes and shrinking writes remain available. The error directs users to delete unused conversations or run cleanup; history is never silently evicted. Existing legacy imports can exceed the ceiling to preserve recovery data, but new growth is refused until reduced. Orphans, backup copies and binaries are outside this live-record accounting; this is not a hard cap on the entire application directory.

A successful record replacement/deletion immediately retires its old blob after commit when no live pointer shares it. Open readers retain their handles; failed/unlink-blocked cleanup is left for GC. Maintenance also completes interrupted legacy imports and removes original JSON copies only after validating the current blob; malformed recovery material is preserved and counted while unrelated compaction continues. The verified cutover backup is preserved automatically.

Maintenance starts 30 seconds after bootstrap, checks hourly, and normally runs once per 24 hours. The background sweeper covers inactive snapshots, with a 24-hour orphan grace and 1024 MiB deletion budget per pass. It preserves retained chats and rollback roots. The snapshot budget prevents new capture growth; it does not automatically delete old oversized repositories. This is not a hard cap on user-authored conversation history, attachments, backups, installed binaries or all of `~/.atomcli`. Failures and protected repositories are logged.

From `AtomBase/`, preview before applying (the preview does not start background maintenance):

```sh
bun run --conditions=browser ./src/index.ts debug storage --all-projects
bun run --conditions=browser ./src/index.ts debug storage --all-projects --apply
```

Without `--all-projects`, snapshot maintenance targets the current project; storage blobs are global. Reports include legacy compaction, diagnostic expiry, orphan counts/bytes, budget limits, and blocked snapshot repositories. A partial block returns exit 1 even if eligible storage blobs were already removed. Previews report candidates, not a guaranteed future deletion count.

Optional configuration (all existing configurations remain valid):

```json
{
  "retention": {
    "enabled": true,
    "orphan_hours": 24,
    "interval_hours": 24,
    "max_delete_mib": 1024,
    "snapshot_mib": 1024,
    "snapshot_file_mib": 2,
    "replay": false
  }
}
```

`enabled: false` disables automatic maintenance; the explicit command still works. The grace and interval cannot be below one hour. Restart all AtomCLI processes onto the updated version before applying cleanup: older binaries do not participate in the new coordination protocol.

Storage GC rechecks references and unlinks under the same SQLite writer lock as pointer publication; publishers republish a collected blob before committing a reference. Readers acquire a file descriptor under that lock and can finish reading a retired version. Shared live blobs, tombstones and the verified cutover backup remain. Legacy originals are removed only by verified compaction. Unknown files and symlinks are not deletion candidates.

Snapshot tracking pins newly created trees. Maintenance discovers snapshot, patch-before/after, and session-revert trees from all retained sessions in the project, including interrupted legacy imports, validates every object, then publishes the retained roots before expiring unused pins and running Git GC. An unreadable record, missing tree, unsafe directory, or unfinished/uncertain execution postpones that repository's cleanup. Cross-process SQLite locks serialize snapshot readers/writers and maintenance and release automatically on crash. Grace protects new and not-yet-persisted roots; unfinished executions prevent age-based eviction of their pins.

Run `test/core/data-retention.test.ts`, the storage manifest/backup/migration tests, and `test/snapshot/snapshot.test.ts` when changing this policy. Do not replace root discovery with file-age deletion or raw `git prune`.

When the bundled AtomCLI guide changes, validate its frontmatter, reference paths, development coverage, and runtime discovery:

```sh
cd AtomBase
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json bun test test/skill/atomcli-guide.test.ts
bun run --conditions=browser ./src/index.ts skill list
bun run --conditions=browser ./src/index.ts skill show atomcli-guide
```

The `eval benchmark` command measures model-driven agent behavior and is not part of the deterministic validation commands above. Without `--execute` it only reports stored observations. With `--execute`, every case materializes its own fixture into the workspace, prompts the selected agent under a hard per-case timeout, and is then graded by an independent verifier before all changes are reverted. Verifier sources are moved out of the worktree for the duration of a run and restored automatically, including after interruption. On an interactive terminal the command offers provider, model, and agent menus unless `--model` is given. Use `--routing fixed-base|fixed-expert|adaptive`; fixed-expert requires `--expert-model`, while adaptive may use it as the bounded expert candidate. The same versioned fixtures report route calls, expert episodes, unpriced calls, TTFT, proposals/rejections/repeated questions, and base returns. Executing the benchmark contacts the selected provider, consumes quota, and takes minutes per case. Fixture results are not live provider verification. See `AtomBase/evals/README.md`. Live benchmark execution prints its JSON report and exits 1 if any case fails, times out, or lacks a passing observation; exit 0 requires all cases to pass, including their independent verifiers. Stored reporting without `--execute` stays read-only and exits 0 when reporting succeeds. Test observations use chronological message order. Turn totals include recovery calls created before the terminal completion time, even when the terminal message was created earlier. Synthetic continuation prompts remain part of the original request; a new real user request starts a separate turn. Benchmark observations, including correction signals, remain in the report but do not update runtime model-quality history; independent verifier results determine benchmark acceptance. Recovery preserves `2>&1` in compound checks; a trailing unquoted stderr-to-stdout duplication does not change Bun test scope. A terminal error is unsuccessful. Failed fixture setup is reverted. Headless benchmark tool-permission prompts are rejected immediately with an explanation; configure explicit permissions for the authorized workspace before execution. No permissions are auto-granted and configured denials remain enforced. To resolve an open verification failure, rerun its full command successfully in the same working directory after repairs; separate passing files do not replace a failed grouped or directory test run.

## Build and release

For the mobile acceptance layers, run `flutter analyze` and `flutter test` from `companion/`, the Companion server tests from `AtomBase/`, and `bun run test` from `libs/companion/`. With an Android emulator booted, run `python3 tool/test_android_integration.py --device <adb-serial>` from `companion/`. This uses a separate debug test package and two isolated real AtomCLI processes; only model responses are scripted. The cancellation case must abort an active request before its first token and verify server survival and absence of a late completion; observe SDK text-result promises once so cancellation cannot leave a rejected getter result unhandled. See [Companion testing](../companion/README.md#android-integration-suite) for evidence paths, coverage and physical-device checks. Companion remains beta; emulator success does not establish OEM background behavior or release signing.

```sh
cd AtomBase
bun run build
```

`AtomBase/script/build.ts` removes `dist/` before each build, bundles the application for supported targets, and includes root `.atomcli/` and `.claude/` assets. Do not store source files in `dist/`.

Pushing a `v*` Git tag is the only automated release trigger. This repository does not track a release helper script; maintainers may use an ignored local helper, but must not manually publish generated release directories.

Release jobs run from a clean checkout. The build copies root `.atomcli/` and `.claude/` directories, so only tracked, reviewable skills and agents belong there. Local configuration, credentials, package manifests/locks, installed dependencies, plans, runs, and session state must remain ignored.

The build matrix produces Linux x64/ARM64 (glibc and musl), macOS x64/ARM64, and Windows x64/ARM64 executables. Alpine runtimes for the musl builds must provide `libstdc++` and `libgcc`; the release installer and platform smoke workflow install these packages. x64 baseline variants cover older processors without AVX2. Stable GitHub releases also build, test, sign, checksum, and attach `atomcli-companion-android.apk`. Bun has no FreeBSD runtime or compile target, so FreeBSD cannot be advertised as a supported AtomCLI runtime; platform-specific helpers should still fail clearly or use a system executable where possible.

The published Android APK must use one persistent signing identity so users can install later releases as upgrades. Configure the repository secrets `ATOMCLI_ANDROID_KEYSTORE_BASE64`, `ATOMCLI_ANDROID_KEYSTORE_PASSWORD`, `ATOMCLI_ANDROID_KEY_ALIAS`, and `ATOMCLI_ANDROID_KEY_PASSWORD`; the tag workflow fails before building the APK when any value is missing. The keystore itself must never be committed. A local `flutter build apk --release` without these environment variables deliberately uses the debug identity for device testing only and must not be distributed. Every tag builds a fresh APK and verifies that its manifest version matches the release version; an older release APK is never substituted.

### Pre-release repository check

Use `AtomBase/package.json` as the release source of truth. Keep the versions in `libs/companion/package.json`, `libs/plugin/package.json`, `libs/script/package.json`, `libs/sdk/js/package.json`, `libs/util/package.json`, and the Flutter manifest under `companion/` aligned with it, then update `bun.lock`.

Do not edit those mirrored versions individually. Set and propagate a release version from the repository root:

```sh
bun run version:sync 3.4.3
bun run version:check
```

`version:sync` updates the source manifest, workspace mirrors, lockfile, and release-note heading. `version:check` is read-only and runs in both CI and the release workflow so version drift cannot be published.

Prepare the package manifests, lockfile, and `RELEASE_NOTES.md`, then run the complete release audit without changing Git or contacting GitHub:

```sh
cd AtomBase
bun run typecheck
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json bun test
cd ..
bun turbo typecheck
bun turbo test
git diff --check
git status --short
git status --short --ignored
git ls-files -ci --exclude-standard
git ls-files --others --exclude-standard
```

These commands run package and workspace validation, check patch formatting, expose ignored and untracked artifacts, and detect tracked files hidden by ignore rules. Review `RELEASE_NOTES.md` separately and verify that its heading matches `AtomBase/package.json` and contains no emoji.

Before committing, search the repository for the previous AtomCLI version. Matches in third-party dependency versions are not release metadata and must not be changed.

The underlying repository checks are:

```sh
git status --short
git status --short --ignored
git ls-files -ci --exclude-standard
git ls-files --others --exclude-standard
```

Review every tracked and untracked path. `git ls-files -ci --exclude-standard` must print nothing: a tracked file hidden by an ignore rule can otherwise change without appearing in normal status output. Do not force-add local `.atomcli/` or `.claude/` state. Do not commit `AtomBase/dist/`, `release_assets/`, logs, credentials, or generated test sandboxes.

The release version is sourced from `AtomBase/package.json`. After explicit authorization, commit the reviewed changes, create the exact `v<version>` annotated tag, and atomically push the branch and that tag. For example, with `VERSION` set to the package version:

```sh
git commit -m "release: v${VERSION}"
git tag -a "v${VERSION}" -m "AtomCLI v${VERSION}"
git push --atomic origin main "refs/tags/v${VERSION}"
```

Do not replace the exact-tag push with `git push --tags`. Confirm that the local and remote tag do not already exist, fetch the latest remote state, and verify that local `main` contains `origin/main` before publishing. The tag push starts `.github/workflows/release.yml`, which builds and publishes the GitHub release.

## Configuration

The configuration schema is `AtomBase/src/core/config/config.ts`. Its precedence, from highest to lowest, is:

1. `ATOMCLI_CONFIG_CONTENT`
2. Project `atomcli.jsonc`, `atomcli.json`, or `mcp.json`
3. The file specified by `ATOMCLI_CONFIG`
4. Global files in `~/.atomcli/`
5. Remote well-known configuration

Global files include `config.json`, `atomcli.json`, `atomcli.jsonc`, and `mcp.json`. New configuration fields must remain backward compatible and optional with defaults.

### Adaptive execution and classification

Adaptive execution pipelines (`direct`, `focused`, `coordinated`) are active by default. Work boundaries and risk escalate based on runtime tool effects and observable workspace mutations. Adaptive execution starts with a 30-tool-call slice; at 80% consumption, the active model enters a tool-free checkpoint mode and may request another slice, clamped to 50 calls. Checkpoints are append-only durable records and user-visible transcript events. Plan revisions remain immutable, may add newly discovered work, and completed items may reopen with evidence. Slice extensions stop after twenty grants, and repeated calls, targets, errors, or consecutive slices without verified progress stop new work and enter a separate tool-free final-response phase. This phase does not consume work-step, work-tool, or execution model-call allowance, and it reports completed work plus technical, verification, or procedural harness blockers. A checkpoint `continue` grant extends the adaptive work slice inside the durable ledger, but explicit `execution_budget.max_calls` and `max_steps` remain hard admission ceilings for work. A tool-free checkpoint turn does not claim another work step when that ceiling has been reached. Slice growth stays bounded by the twenty-grant extension ceiling and 50-call slice clamps. Cost ceilings (`max_cost_usd`, `session_max_cost_usd`, `project_max_cost_usd`) and the deadline are never raised by adaptive policy.

Changing the model route alone does not count as verified progress across checkpoint slices.
Root completion retries retain the root session's checkpoint progress history even when a synthetic repair message changes the invocation ID. Child checkpoint history remains scoped to its invocation; child observations cannot reset the parent's no-progress counter.
A `continue` grant consumes its checkpoint trigger. The same recorded evidence and route/plan state cannot immediately trigger another watchdog checkpoint; the next work slice must run first. Explicit checkpoint requests and hard budget boundaries still apply, and new tool evidence or route/plan changes can trigger the next checkpoint.
Successful tool results count as new checkpoint evidence when their command/result fingerprint changes, including write-authorized Bash builds and artifact checks without a `filePath`. Permission/effect classification remains independent of progress detection. Bash hashes its full streamed output, so truncation paths do not manufacture progress and changes beyond the preview remain visible. Write authorization alone does not clear bounded result history; known changed files invalidate previous verification results. Repeated commands with unchanged results still trigger the loop guard. This evidence measures work progress, not satisfaction of the user's acceptance criteria. Checkpoint prose such as “complete” never rewrites a `continue` decision into `finish`.
Tool-free finalization buffers response text and rejects raw DSML/XML tool-call markup. It allows one report retry, then publishes a deterministic report from recorded checkpoints, taskflow steps, and command logs with the runtime stop reason. A hard step limit produces `budget_exhausted/step_limit`; no-progress or unresolved procedural constraints produce `blocked/resource_limit` with the recorded explanation. Report text cannot convert either into successful completion, and a child's report does not terminate the parent execution.
Route guidance is reconstructed from durable checkpoints after restart, including the count of consecutive unsuccessful revisions.

### Reviewer coordination

Subagent permission composition preserves ordered, scoped exceptions to a permission's deny-by-default rule. Global grants do not erase the native reviewer's browser observation allowlist or its interaction/source-write denials. Concrete hard denies and the final `todowrite`/`todoread`/`task` denials still apply; a later explicit wildcard denial closes the allowlist.

Parent, child, and reviewer work share the root execution ledger but not ownership. Reviewer invocations are authorized by the concrete review claim; native tool/command permissions remain enforced. While the root is `finalizing`, mutating verification work is limited to `bash`, `browser`, and `lsp`. Each reviewer has at most 30 tool operations, 12 native prompt steps, and 180 seconds; explicit execution call/step, cost, duration, ownership, and fence limits remain hard and shared. Reviewer verification work does not consume the root slice, mutation revision, tool evidence, or checkpoint state. Content snapshots and review diffs still reject changes to reviewed files; uncertain side effects remain durable unknown work. Reviewer prompts do not enter the root completion gate; a reviewer timeout cancels its invocation and late results cannot replace the cancellation.

Agent dispatch keeps one independent `agent` task blocking. Multiple independent tasks use `agent(action="workflow", workflow_action="plan")`, then `execute`; ready DAG layers run concurrently (bounded to four), while `dependsOn` controls ordering. `timeoutSeconds` applies only to `wait`; `executionTimeoutSeconds` bounds the child attempt itself. A timed-out child is fenced as failed with deadline evidence, siblings continue, and a late result cannot become accepted. `finish` checkpoints finalize the child response once; they do not complete the root execution. A failed workflow is never silently replayed: use `workflow_action="recover"` with the current task version/revision, workspace artifact paths, and a passing verification command when needed. Recovery accepts the durable task only after those checks and retains the failed invocation history.

Workflow ownership uses the Git worktree when the session runs inside it; otherwise it uses the active session directory, including `/tmp`. `owns` accepts relative paths from that root or absolute paths inside it. Claims are literal file/directory paths, not globs; patterns such as `wordCount*` are rejected. List `wordCount.ts` and `wordCount.test.ts` separately and keep those names in the task prompt. Children receive their actual execution workspace and claims in a `task_ownership` prompt block. For isolated tasks this is the child worktree, not the parent directory. Traversal and symlink escapes are rejected before planning or dispatch. A rejected plan creates no workflow tasks or blockers. Ownership does not grant permission: children retain permission checks and parent denies. Do not retry a denied path through another tool or child. Workflow attempts stop on deterministic permission/ownership errors or terminal runtime constraints; provider, QA, and result-validation retries remain bounded. Child assistant errors preserve `data.message` in the parent result.

Git-free children with `owns` write through `edit`/`write`, with checks on both supplied and canonical paths. Their shell commands require an OS read-only sandbox (`bwrap` on Linux, `sandbox-exec` on macOS); unavailable enforcement fails closed. The parent can run the automatic acceptance commands. Git isolation and its ownership-checked merge remain unchanged. Failed workflow checkpoint messages include the durable workflow ID and state; recovery still requires artifact and verification evidence.

Recovery checks both the supplied artifact path and its resolved symlink target against the workspace, task ownership, and read permission. Retargeted symlinks are rejected before reading. Verification must leave the artifact digest and execution mutation revision unchanged. Original automatic acceptance commands still apply; parent/reviewer acceptance requires the normal task verification flow. An interrupted recovery can resume with fresh task version/revision evidence. Root or child cancellation wins over a later ordinary completion/failure; explicit child execution deadlines remain `timed_out` in the lifecycle and `failed` with `deadline` evidence in the durable invocation. This mapping uses existing SQLite records, without a schema migration.

Independent review is optional for every scope and risk. `review.auto: true` explicitly opts into policy-triggered review. `agent(action="spawn", subagent_type="reviewer", prompt="Review changes and test results independently")` remains available. Count defaults to one; multiple reviewers require explicit requests or configuration. Skipped completion review is durable `not_required`, never PASS. Timeout, cancellation, and inconclusive review remain separate from the code outcome, with a persisted warning and `inconclusive` claim. Failed checks, validated findings, unresolved work, uncertain effects, root cancellation, fencing, isolation, and hard budgets still prevent false success.

If `run` loses its event stream before receiving session idle, it must not return success. Prompt runs bind their message ID; interruption attempts bounded, version-checked cancellation of that exact execution, never a newer user turn, then reports `Session event stream ended before completion`. A disconnected or repeatedly conflicting control plane may prevent cancellation; the error remains visible rather than being reported as completion.

### Checkpoint self-critique

For explicit 3D game requests, classification derives projection/depth, spatial gameplay, requested camera/collision, and any explicit WebGL requirements before mutation. The reviewer uses the same criteria. Interaction proof uses real pointer/keyboard input: helper calls, state assignments and DOM `.click()` are setup, because they can skip focus/pointer event paths. `fill()` does not prove physical keypress handling. Check sustained movement in every documented direction with elapsed-time consistency, actual objective progression, and usable forward, quarter-turn and reverse camera views. This clarifies the requested interactive verification; it adds no separate completion gate. A continuation preserves this contract. Revisions require a concrete user-input, mandatory-skill, platform, or runtime-evidence reason; the ledger records the revision, reason, and invalidated evidence. A revision clears prior browser verification and changes the review acceptance hash. Optional review still does not turn smoke evidence into semantic proof.

Skills can declare `dependencies: [{ name: frontend-design, when: [web, browser, html] }]`. Dependencies resolve before the parent in explicit auto-loading; the existing required-read gate checks dependencies and reference selection before mutation. Missing/cyclic dependencies fail visibly. Current source hashes and continuous read ranges allow reuse of already-loaded reference chunks; changed sources reload. No instruction sections are removed heuristically.

PTY input/resize/resume fixtures select the built-in `atomcli` theme because their fake terminal does not answer palette queries; these tests do not prove system-palette detection. Browser snapshots prefer rendered text for multiline/grid control labels, retaining explicit ARIA names; concatenated DOM text can produce a name the role locator cannot find. Use browser `flow` for one acceptance domain, at most 20 steps, with interactions followed by assertions/evaluation. Every step requires `action`; all steps are validated before any browser action, including the required semantic destination for `drag`. Invalid flows remain unapplied. Locator and semantic-target actionability timeouts before input dispatch preserve earlier successful flow steps without creating unknown work; timeouts after dispatch remain uncertain. Use `input_sequence` for held keys/pointers. Sequence point coordinates are validated before events start; viewport mouse moves/clicks require both coordinates, element-relative points may use the target center. HTTP/HTTPS is the browser tool's fixed navigation capability. Unsupported direct-file obligations become supported HTTP verification plus an explicit unverified limitation; HTTP proof never claims direct-file compatibility.
Real-time gameplay continues while the model reasons between calls. Keep restart/start, timed input and state/frame assertions inside one bounded flow; a later observation can otherwise measure an expired or defeated game instead of the tested movement.

Required element targets, `type` text, and assertion discriminator/target/expected values are schema-validated for the entire flow before its first action; `assert` uses `assertion` and its expected value/target (for example `{ action: "assert", assertion: "text", selector: "#status", expected: "Saved" }`), while arbitrary JavaScript observation uses `evaluate` with `script` (for example `{ action: "evaluate", script: "document.title" }`). The previous per-step target check is removed. A failed browser flow retains successful step outputs. Known assertion failures, completed JavaScript exceptions, and locator preflight failures settle as `failed`; they do not leave unknown work or produce navigation/verification PASS evidence. Transport loss, cancellation, and uncertain mutating failures remain `unknown`. Earlier steps are not rolled back or blindly replayed. Mouse down/up without coordinates use the current pointer position; partial coordinates still require validation.

Successful `edit` results acknowledge the applied mutation even when LSP reports no diagnostics; that acknowledgement is not verification evidence. Source edits clear previous browser proof. Checklist updates persist session state without workspace or external effects, so they retain browser proof. Their calls still consume allowance, but their output does not supply acceptance evidence or reset checkpoint stalls. A successful `navigate` or `reload` establishes that the current artifact was opened; a reload alone supplies no visual or behavior evidence. Runtime browser identity is not an extra acceptance requirement inferred from that opening counter. `static_check` is read-only: checks never increment the source mutation revision, and a failed result records failed evidence rather than successful progress.

Bun compiler errors retain their underlying messages and positions, including constant assignments that `node --check` accepts as syntax. HTML positions refer to the extracted inline script; TS/JSX analysis positions refer to emitted JavaScript. Checking an isolated method body without its parameters can report genuinely missing bindings; it does not establish that the full file fails incorrectly.
Browser globals include `EventTarget`; keyword-named object/class methods such as `get(...)` retain their parameter bindings. Undefined values inside those methods still fail the symbol check.

POSIX shell commands use fail-fast execution; Bash/Zsh/Ksh also use `pipefail`. Automatic acceptance commands use the same invocation. Nonzero Bash exit status is visible in tool output even when the command emits nothing. Explicit shell-execution requests retain Bash capability when classification initially selects direct scope. Expected failures belong in explicit conditional handling. Diagnostic `node --check` probes retain their exit status without creating additional implicit completion obligations; current static checks own source syntax at acceptance/merge/completion boundaries, including source changed by scripts. Failed test/build/typecheck commands still block completion. Explicit command-based acceptance remains authoritative, including a requested Node syntax verifier.

Checkpoint work grants have a minimum of 10 calls to avoid repeated tiny slices. Mutation work without new artifact/browser progress receives at most 10; actual progress can receive the existing maximum of 50. Late source/skill exploration after mutation does not reset the stall counter. Missing legacy taskflow no longer interrupts work; planning remains advisory. `invalidatedWork=[{claim, reason}]` removes exact prior completed claims from future handoffs while preserving ledger history.

Each granted tool operation also grants one adaptive work step, allowing sequential operations to use the granted slice. Explicit execution call/step ceilings, cost, deadlines and extension bounds remain unchanged.

A checkpoint is both a budget decision and a required self-critique. Alongside the `continue`/`finish`/`blocked` decision, the model must report `routeDecision` (`keep` or `revise`), a `selfCritique` of its own performance in the slice, `failedApproaches` that did not work, and `whatToChanges` when revising. It only needs to propose an alternative approach when the current route is stuck, repeating, or producing no new evidence.

Checkpoint and final-response turns use their own output instructions. Generic advice to report missing tool access applies only to ordinary turns with an empty toolset; it must not contradict checkpoint JSON or the final evidence report. Protocol-level `toolChoice: none`, bounded invalid-response retries and rejection of raw tool markup remain enforced.

These fields are not transcript-only. A `revise` verdict, or any recorded failed approach, injects a `route_guidance` block into the next work slice naming what already failed and what must change, so the model is steered away from repeating a dead end. `failedApproaches` accumulate across checkpoints until the model returns `keep` or finishes, bounded to the most recent 50 entries. Four consecutive `revise` verdicts without new work evidence are treated as stall evidence: a strategy that keeps changing without producing progress is blocked rather than granted another slice.

`routeDecision` and `whatToChanges` are the only route signals consumed by the runtime. The model-reported `planChanged` and `routeChanged` booleans remain harness-computed from durable revision counters and are overwritten during reconciliation.

Execution classification is enabled by default; set `experimental.execution_classification: false` to disable it. Greetings and short, simple explanations use a deterministic fast path. Repository inspection and broader analysis use the selected model, with the classifier call admitted against the active execution call/cost budget. Without a model or after classifier failure, explicit read-only requests receive a non-mutating fallback. Fallback results are not cached, so a later model attempt can classify the same request. A follow-up edit request remains a change task. Classifier timeout is bounded at 8 seconds so providers that hide reasoning latency in model metadata do not systematically fall back to the conservative focused contract. Reviewer work starts direct. Runtime evidence can still promote scope and risk, but never downgrade them. Coordinated execution is reached only when the classifier or runtime evidence establishes cross-boundary, wide, or independently delegated work.

Scope and risk are separate decisions: a localized public API or schema edit can remain `focused` while still receiving `critical` risk and review handling. Scope measures coordination breadth; risk measures impact. Do not promote scope solely because an edit touches a public contract.

Execution policy resolution emits diagnostics for contradictory contracts (for example, mutation-required work with no `edit`/`write` capability). Diagnostics are observability signals; they do not silently widen permissions or bypass user/agent filters.

### How a request is executed

```text
User request
  ↓
Session prompt turn (direct fast path or model classifier)
  ↓
Execution contract (intent, scope, risk, uncertainty)
  ↓
Execution policy (budget, scope-aware tools, review/checker gates)
  ↓
Model route (manual pin first; adaptive/base→expert only when allowed)
  ↓
Tool registry → agent capability → execution policy → permission → runtime admission
  ↓
Tool/evidence updates and bounded adaptive promotion
  ↓
Checkpoint/taskflow or review when required
  ↓
Durable completion projection and user response
```

Authoritative modules: classification is in `AtomBase/src/core/routing/execution-classifier.ts`, policy in `execution-policy.ts`, model proposals in `AtomBase/src/integrations/tool/model-control.ts`, tool inventory in `AtomBase/src/integrations/tool/registry.ts`, runtime filtering/admission in `AtomBase/src/integrations/tool/runtime.ts`, and durable execution state in `AtomBase/src/core/execution/ledger/`.

### Conversational turn detection

On the default `agent` mode, a short turn is treated as conversational only when it carries positive evidence of being a question or a greeting and names no work surface. Absence of action keywords is deliberately not sufficient: continuations such as "devam et", "bir bakar mısın" or "hadi başlayalım" contain no keyword but still need task tools under their execution policy.

An empty execution-policy allowlist means no task tools, not unrestricted tools. A direct answer retains `read`, `model_control` and `scope_control`: the genuine read capability preserves coding-agent request context, while file permissions and the three-tool-call limit still apply. Direct execution permits one retry; when only one retry remains, the processor can use it for eligible model fallback. An explicit zero retry limit still stops immediately. Only an absent allowlist permits all otherwise authorized tools. Checkpoint and final-response phases remain tool-free; their system prompt states why and instructs the model to say so plainly instead of guessing or claiming completion.

The classifier's scope is the session floor for later turns. A short "Devam" or "continue" after an unfinished execution also inherits its intent and required tools; a completed execution does not. Focused design work receives `edit` and `write` when its contract requires workspace changes. `lsp` formatting previews edits by default and applies them only with `apply: true`.
While a child invocation is running, parent checkpoints hold the no-progress counter steady until the child returns. The extension cap and configured execution budgets still apply.
Coordinated builds expose `todo` for visible planning and `agent` for delegation. Neither a checklist nor a checkpoint claim supplies acceptance evidence. Existing durable plans retain ordered transitions; tool command or filename resemblance does not skip their steps.
Normal turns also keep the hidden `invalid` repair tool in the SDK schema. It is excluded from advertised `activeTools`, but turns an unavailable call into a visible tool result so the next model step can use the refreshed scope and tool set.

Only the root conversation may escalate or reset scope. Child agents may inspect status, but cannot change the shared execution policy. Reset changes the session floor for future turns; the active execution remains at its current scope.
Scope escalation has no cooldown by default, so a direct turn can recover through focused to coordinated without waiting. `experimental.scope_escalation.cooldown_ms` adds a delay when configured; the per-session escalation count still applies.
`scope_control(action="status")` reads persisted escalation count/cooldown from the ledger and shows the next scope's policy-level tools and subagent eligibility. Agent allowlists and user permissions remain separate filters.
`scope_control` changes execution metadata, not workspace files. Tool runtime treats it as a control operation: status does not create mutation evidence, and scope checks do not automatically start a pending taskflow work item.
Focused `answer`, `inspect`, and `design` contracts omit `edit` and `write`; focused `change` and `operate` retain coding tools. `bash` remains available for diagnostics under its normal command permission/effect checks, so this is tool advertisement narrowing, not a read-only security sandbox.

Policy-triggered review requires workspace mutation evidence. Conversation-only and read-only turns do not automatically launch reviewers. Explicit reviewer agent calls can inspect existing code without edits.

### Where do I make this change?

- Execution admission, leases, reservations, and budget policy: `AtomBase/src/core/execution/ledger/admission.ts` and `AtomBase/src/core/execution/ledger/policy-state.ts`.
- Checkpoints and continuation projection: `AtomBase/src/core/execution/ledger/checkpoints.ts`, `projection.ts`, and `cancellation-outbox.ts`.
- Completion and review persistence: `AtomBase/src/core/execution/ledger/completion.ts`.
- Taskflow/work blockers: `AtomBase/src/core/execution/ledger/work.ts`.
- Route proposals and execution routing: `AtomBase/src/core/execution/ledger/routes.ts`.
- Public execution views and queries: `AtomBase/src/core/execution/ledger/execution-view.ts` and `queries.ts`.
- Session prompt context, checkpoint handling, and turn routing: `AtomBase/src/core/session/prompt/`.
- Provider catalog/configuration versus runtime transforms: `AtomBase/src/integrations/provider/`.
- Browser schemas/validation versus execution: `AtomBase/src/integrations/tool/browser/` and `browser.ts`.
- Companion transport/state versus screen widgets: `companion/lib/services/`, `companion/lib/providers/`, and feature screen directories. Wire/domain models stay grouped by ownership under `companion/lib/models/`, with `companion/lib/models.dart` as the stable import entrypoint.

Normal coordinated tools do not require a model-authored taskflow. `taskflow`, `orchestrate`, and legacy `task` remain compatibility/internal mechanisms rather than the advertised coordination surface. If a durable plan exists, real work atomically advances its first pending step to `running`, retaining lifecycle ordering and revision history. A model-reported external blocker leaves the execution active in `waiting_input`, so later user input resumes the same execution and allowance state; watchdog and extension-ceiling blockers instead produce the final report immediately.

Shared coordination instructions use the advertised optional `todo`/`agent` surface. The classifier sees the full request and preserves non-game acceptance extracted into its existing contract; deterministic 3D evidence criteria remain. Neither extraction nor a checklist proves that every requirement was covered.

The bounded lexical project map recognizes function declarations in JavaScript/TypeScript, Python, Go (including receivers), Rust, Kotlin and Swift. It is a navigation hint, not an AST or a complete cross-language dependency graph; use LSP and source reads for precise definitions. Existing file-count, size and cache limits remain.

Replay keeps terminal tool errors after provider failure and omits attachments belonging to pruned tool output. Skill deduplication uses current-source bodies in active context, separately from durable read evidence; compaction summaries do not prove a body is available. Failed or aborted browser flows release nested key and pointer holds. These behaviors have fixture-backed regressions; general model/output-quality gains require separate live comparisons.
Build and default agent prompts perform one bounded self-review before completion: missing acceptance evidence, boundary failure risk, and the least convincing changed area. This review fixes material findings and repeats the smallest relevant check; it does not create an unbounded second implementation pass.

## Architecture

| Concern                      | Location                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| CLI registration             | `AtomBase/src/index.ts`                                                                          |
| CLI commands and TUI         | `AtomBase/src/interfaces/cli/cmd/`                                                               |
| Configuration                | `AtomBase/src/core/config/config.ts`                                                             |
| Project-scoped state         | `AtomBase/src/services/project/instance.ts`                                                      |
| Sessions and prompt assembly | `AtomBase/src/core/session/`                                                                     |
| Providers                    | `AtomBase/src/integrations/provider/`                                                            |
| Tools                        | `AtomBase/src/integrations/tool/`                                                                |
| Skills                       | `AtomBase/src/integrations/skill/` and `AtomBase/src/integrations/tool/skill.ts`                 |
| MCP                          | `AtomBase/src/integrations/mcp/`                                                                 |
| Server routes                | `AtomBase/src/server/`                                                                           |
| Companion networking         | `AtomBase/src/interfaces/cli/network.ts`, `AtomBase/src/server/server.ts`, and `libs/companion/` |
| Agent evaluation             | `AtomBase/src/core/eval/`                                                                        |

Follow the namespace export pattern and use path aliases (`@/*`, `@tui/*`). Code built with `--conditions=browser` must use type-only imports for `ai` and dynamic imports for its runtime use.

### Session execution invariants

- A session run owns its abort controller. Cleanup from an older run must not cancel a replacement run for the same session.
- The configured retry count is a retry budget after the first model attempt. Once exhausted, the processor records the terminal error and must not wait, select a fallback, or call the model again.
- The final agent step includes the maximum-step instruction and passes an empty tool set to the model. Step limits are enforced by execution behavior, not only by prompt text.
- If final-step completion is blocked by an open taskflow, workflow, or child session, AtomCLI records and projects a visible `budget_exhausted/step_limit` outcome instead of creating a continuation that cannot use tools or ending with a reasoning-only message.
- Only one live `execute` call may own a workflow. A checkpoint whose process stopped can be resumed, while a second call against a currently owned workflow reports that it is already running.
- Coordinated agents can call `orchestrate` once with `{ "request": "plain-language task" }`; omitted `action` defaults to `run`. This plans one task and executes it through the same permission, checkpoint, retry, and QA path as a planned DAG. Multi-task workflows still use `plan` then `execute` with the returned `workflowId`. Direct execution checks `task` permission for each agent before dispatch.
- Tracked `task` work uses the execution ledger. Child completion is `submitted`; `task(action="verify")` checks acceptance before `accepted`. Generic ledger checks accept only parent/reviewer evidence. Automatic checks use the configured command's exit code, never a caller's `passed` flag. Stored checks carry `verifier`, `verifierID`, `taskRevision`, and `verifiedAt`; old revision checks cannot approve current work.
- `task(action="revise")` retains history and `supersedes`, reopens the selected task and its dependency subtree, and preserves unrelated accepted tasks. Missing dependencies and cycles are rejected by the ledger. Orchestrate clears stale task output and completion state on revision and reconciles status from the ledger after reload. A stale child result leaves the workflow resumable; failed acceptance can retry `needs_revision → running` within the existing retry budget.
- A root checkpoint cannot finish while durable taskflow steps remain open. It grants a bounded work slice so the parent can receive child review results, fix defects, and reconcile the plan. Child reviewer checkpoints can finish independently of the root plan. The step threshold requests one checkpoint when first crossed; later turns continue until another checkpoint cause or a hard budget limit applies.
- An explicitly requested independent review step remains open until reviewer PASS; missing evidence stays unresolved. Ordinary completion does not create such a step. Timeout, cancellation, and inconclusive results remain separate from the code outcome.
- Child prompts must preserve the user's acceptance criteria. A delegated browser game cannot replace a requested real 3D renderer with a 2D perspective drawing.
- After a delegated task edits files, its `agent_result` must be valid JSON with `status: "complete"` and an empty `failures` array before workflow completion. Missing, malformed, or explicitly incomplete results are retried within the task limit and otherwise reported as failed, even when automatic reviewer QA is disabled.
- Read-only reviewer/checker inspection status is separate from product verdict/findings. Reports remain available to editing agents. Incomplete optional QA is reported separately, never PASS, without repeating completed worker side effects.
- Watchdog tracks semantic signatures (normalizing command and working directory) and blocks three consecutive unchanged semantic results. Repeated browser recovery steps separated by distinct successful observations do not count as an unchanged streak. Slice, no-progress and extension limits still bound alternating loops.
- Browser `fill` replaces a targeted field value atomically, including inside bounded flows. `type` remains compatible: atomic by default, physical sequential keys when `delay` is supplied. `fill` always stays atomic even if `delay` is supplied; both actions retain target/text validation and the same ownership boundary.
- Reminder injection is tied to new mutation revisions and distinguishes production code from test, fixture, generated, and example paths to prevent false-positive loops.
- When execution limits are reached, finalization proceeds unidirectionally: work tools are disabled, the model is given one final turn and one repair attempt, and a rich deterministic fallback is generated if no usable text is returned, ensuring zero empty assistant turns.
- Whitespace-only model text is not persisted as an assistant part and follows the bounded empty-output retry path. An invalid tool-free checkpoint drops its empty assistant turn before retrying; its failure count remains durable.
- A compaction summary becomes a history boundary only after its linked transaction is committed. Empty, whitespace-only, unfinished, and non-shrinking summaries are rejected without hiding the prior context.
- Compaction control messages continue the current execution, preserving its objective, plan, and consumed allowance; they must not cancel it or start a new root invocation.
- A completed tool call/result remains in model history even if the provider fails later in the same assistant turn. Tool replay records distinguish an execution failure from an operation that completed before post-processing failed; the latter must not be retried automatically.
- Benchmark execution requires a fresh sanitized Git object database: no verifier history/reflogs, alternates or unreachable objects. Use a disposable filesystem sandbox excluding original checkouts, reports and backups; Git preflight alone cannot hide other host files. See `AtomBase/evals/README.md` for the preparation contract. Answer-bearing regression implementations stay under private `verify/` trees. Native tools deny private evaluator paths and their symlink aliases across child sessions. Benchmark Bash requires Linux bubblewrap with private mount masks and restricted process visibility; an OS probe runs before prompting. No sandbox/test bypass applies. Verifier stashes live under `~/.atomcli-eval-verifier-stash/` (0700), outside trusted `.atomcli` data; legacy interrupted stashes remain recoverable.
- Benchmark hidden verifiers are stashed outside the agent worktree. Every `verify/` directory beneath the cases root is hidden recursively, including nested copies. Discovery does not follow symbolic links. Each move records an atomic recovery manifest before the rename. Missing or unreadable case roots and symbolic-link verifier paths fail closed. Recovery rejects corrupt manifests, paths outside the expected roots, and symbolic-link ancestors in both source and stash paths; it replaces any verifier directory recreated by the agent and preserves the manifest when both copies are missing. Copy fallback applies only to cross-device rename failures.
- Optional `execution_budget` limits are snapshotted into a SQLite/WAL ledger per explicit root user turn. Root and child invocations keep an explicit persistent execution binding. Calls and steps use the execution scope, while root-session-tree and project cost totals remain distinct; every configured scope is admitted atomically. Dispatch rechecks the fence and deadline, and dispatched calls with unknown outcomes remain charged as uncertain across restart until late usage settles them. Verification probes retain the originating execution context and combine caller, deadline, and execution-lease abort signals.
- Resuming a terminal execution uses the prompt's optional `resumesExecutionID` and creates a new execution segment linked to the prior one. Segments share `budgetScopeID`, cumulative calls, steps, cost, and the original deadline; a resumed policy may tighten but cannot extend those limits.
- Verification probes and auxiliary review, compaction, and memory requests belong to the same execution budget. Auxiliary memory learning starts only after the main response so it cannot win the initial reservation race.
- Automatic prompt memory recall uses BM25 ordering without a model request on each tool step. Explicit memory searches can use model reranking; its five-second request deadline aborts the request, with no SDK retries, and execution cancellation propagates to it. Failed reranking retains BM25 order.
- Executions use renewable owner leases and monotonic fencing. A reference-counted execution-lifetime controller renews ownership across model, review, and tool work; cancellation or lease loss aborts the shared signal and therefore the active stream/tool path. Takeover is allowed only after lease expiry; it releases reservations that the old fence never dispatched, while the stale owner cannot claim steps, reserve or dispatch calls, invoke a tool, or commit a final candidate. Late usage may still settle work dispatched before takeover.
- Cancellation is a persistent execution state, not only an in-memory abort. Review and child-agent work receive the parent abort signal, and tool execution rechecks execution ownership immediately before invocation. A tool that applied a side effect before bookkeeping failed is still reported as applied and must not be retried automatically.
- Child `executionTimeoutSeconds` starts before runtime spawn and includes preparation, permission waits, model streams, tools, and checkpoints. `timeoutSeconds` only bounds `agent(action="wait")`; it does not cancel or extend execution. File creation and passing tests do not replace the final `agent_result` and terminal invocation/task states. Shell redirection to the exact `/dev/null` needs no external-directory grant; other redirect destinations and bash permission remain checked.
- Cancellation advances running tool work to `draining`. The original owner may settle its already-started work across that cancellation revision, even after the invocation ends; owner, fence, lease, and all other CAS checks remain enforced. An aborted mutating tool result becomes `unknown`, a read-only result `cancelled`; neither turns the timed-out invocation into success. Unknown effects still require explicit reconciliation and failed workflow tasks still require verified recovery.
- After a child finishes, a failure to archive its output under `.atomcli/runs/` appears in the workflow result. It does not rerun the child or discard its completed work.
- Workflow success and failure archives cap text output at 100 KiB and other artifacts at 5 MiB, preserving valid UTF-8 while marking truncation.
- The in-memory workflow limit stays at 100. New plans or restored workflows reject capacity exhaustion; cleanup evicts the oldest terminal records by creation time and never running work. Plans left unexecuted past the one-hour TTL free their memory slot while their durable record remains addressable by ID.
- Workflow capacity reservation and restore use a shared process lock, so concurrent sessions cannot both reserve the last slot.
- Workflow lookup treats only a missing stored record as absent. Corrupt JSON or storage I/O failure surfaces as a recovery error so prior work is not mistaken for a new workflow.
- A workflow left `running` after its execution lease expires becomes `resumable` with in-flight tasks marked `unknown`; it is not replayed automatically. A live in-process run or valid lease keeps its running state.
- Workflow abort attempts every worker and reviewer even if one cancellation fails. Failures remain visible as `unknown` tasks in a persisted `resumable` workflow; retrying abort retries those cancellations without restarting task execution.
- Workflow status, execution, and abort require the current session to own the workflow. Direct child-session abort and legacy `task` continuation check the child's parent; combined abort requests validate both targets before cancelling either one. A supplied `agent` spawn `session_id` must name an existing child of the current session. Stored workflows without an owner cannot be controlled.
- Structured output is validated at spawn. Requested reviewer slots persist across retries; fresh PASS is reused only for unchanged content. Incomplete optional QA is preserved separately; validated rejection requires new evidence before retry. Durable claims survive completion while process-local scope is cleared.
- Review claim, reviewer authorization, QA PASS, and completion state are durable. `HarnessState` reviewer verdict counters and in-memory session maps remain process-local; restart recovery therefore restores the durable claim but cannot restore fail-attempt/lifetime ceilings until those counters move into the execution ledger.
- Tool middleware writes a bounded, owner/fence-bound work record after permission and immediately before invocation. Workspace-mutating tools dirty the persistent mutation revision at admission, before a side effect can race completion; duplicate operation IDs are rejected. Running or unknown work blocks staging and commit. A mutating invocation that throws remains unknown because partial side effects cannot be ruled out automatically.
- Final text remains private until atomic completion. Candidates bind content, plan, policy, mutation revision, and fenced ownership. Concrete claims authorize requested reviewers. `passed` approves; `inconclusive` permits an otherwise verified code completion only with a separate persisted warning. Commit still rechecks work, tasks, blockers, owner, and snapshots.
- Validated rejection retains bounded retries and can terminalize as `blocked`. Incomplete optional review retains its `inconclusive` claim and commits a separate warning payload, without inventing PASS or restaging as review-free. Root cancellation, actual failed checks, unknown effects, and explicit unresolved acceptance criteria retain their safety checks.
- Root success and terminal failure delivery use the same durable boundary. `completed`, `failed`, `cancelled`, `budget_exhausted`, and review `blocked` outcomes are immutable; provider/model errors map to allowlisted, redacted reason codes. The terminal outcome, fixed delivery outbox, and versioned `execution.updated` event are written in one ledger transaction. Explicit root cancellation also stages a fixed local message/part delivery, including when no assistant message existed yet; child-only cancellation does not terminalize the root. A projector must claim each delivery with a short lease and opaque token, write every message/part under the exact session generation, and ACK with the same digest, generation, owner, and token. A takeover invalidates the stale projector, while an ACK retry by the winning token is idempotent. An invalid payload or missing target message is fenced into visible `recovery_required` state instead of entering an unbounded retry loop. Processor and model-resolution failures do not expose terminal `finish` or `time.completed` before this commit.
- Public execution state is available through the session-scoped list, detail, snapshot, replay, cancel, and reconcile endpoints. Execution views expose redacted `unknownWork` operation IDs and CAS versions, including unresolved work on terminal executions. List cursors are opaque and tied to the root session and database epoch. Snapshot state and its durable cursor come from one ledger transaction. Cancellation and reconciliation require a caller request ID plus exact execution version; reconciliation additionally requires the exact unknown-work version and bounded evidence. Duplicate request IDs are idempotent, while stale or conflicting requests fail without changing state.
- Durable execution replay returns `resyncRequired` for an epoch change, cursor-ahead request, or retention gap. Budget reservation, dispatch, uncertain/settled usage, and late actual usage advance the execution resource version; configured cost scopes emit durable 80% and 100% warnings once per scope and policy version. Blocker creation and CAS transitions likewise emit versioned `execution.blocker.updated` events. The transient `/global/event` stream has a separate process epoch and emits `server.resync_required` for legacy cursors, process changes, future cursors, or its bounded replay gap. It must not be confused with the durable execution cursor or Companion bridge cursor. Global and instance SSE writers allow at most 256 pending events or 2 MiB per client and clean up the subscriber and heartbeat on abort, overflow, or write failure.
- Session deletion carries its new generation into an idempotent `execution.deleted` event, abandons pending delivery, and never overwrites an already selected terminal outcome. Repeating deletion creates no new event. A terminal execution is excluded from active-session inheritance even if its compatibility pointer has not yet been cleaned up.
- A takeover marks abandoned running work `unknown`; the stale fence cannot finish it and the new owner must explicitly reconcile it. Unknown mutating work blocks a new root prompt, while stale root invocations with no unknown work are closed during the next atomic bind. Startup recovery also completes expired legacy auxiliary invocations with no open work. A rejected bind terminalizes its otherwise-empty execution as `failed/recovery_required` instead of leaving an active record. Synthetic review continuations replace their prior invocation inside the same bind transaction and retain the execution budget. Tool ownership is rechecked after permission and around middleware at the actual tool-body boundary, and the work record stays open through after hooks and result replay. Filesystem permission failures before an edit or write reaches disk, and browser target timeouts that occur while still waiting for a locator, are recorded as not applied so the agent can choose another strategy without forcing unknown-work recovery. Reconciliation never cancels the execution: active work continues, while abandoned invocation state is retired by the next atomic prompt bind. Taskflow items, workflows, children, and verification jobs use durable blockers; `resolved`, explicitly authorized/reasoned `waived`, and terminal `cancelled` attempt blockers satisfy this gate; required durable tasks must still be accepted. Ordinary prompt cleanup does not call the explicit cancellation path. Terminal executions reject new work while still allowing committed projection recovery and late usage settlement. Session projection is idempotent, so restart recovery can finish a committed delivery without rerunning the model.
- Tool argument validation and rejected permission checks are recorded as not applied, even when permission is requested from inside a tool body. Tools may classify mutation per operation: LSP queries, browser inspection actions, system health checks, and agent status/wait calls remain read-only, while their state-changing variants retain unknown-work protection. Edit/write validation failures before the filesystem call do not enter recovery; failures after a confirmed write are marked applied. LSP diagnostics after edit/write are best-effort and bounded to two seconds so successful filesystem changes cannot leave a tool hanging.
- An `edit` attempt on an unread file remains unapplied. If read permission allows it, the tool returns a bounded file excerpt and content hash and records the read, so the next edit can use that snapshot. `write` does the same for small existing files; larger files require an explicit read before a full overwrite. A denied read returns no file content.
- Edit accepts a prior Read content hash across successful edits in the same execution only while the file matches that execution's last written revision. Read anchors are rebased through that execution's edits when their boundaries remain clear; a crossing edit requires a fresh Read.
- Text attachments supplied as data URLs are decoded from the payload only. Base64 and percent-encoded UTF-8 are supported, malformed input is rejected, and decoded text is limited to 1 MiB.

Cover changes to these paths with deterministic retry, continuation binding, abort ownership, stale-fence tool admission, finalizing dispatch, mutation-during-review, terminal reserve rejection, workflow ownership, compaction commit, tool-evidence, and attachment-decoding tests.

## Server API and SDK

`GET /session/:sessionID/executions`, `GET /session/:sessionID/executions/:executionID`, and `GET /session/:sessionID/execution-snapshot` expose redacted durable execution state, including `unknownWork` records that need a user decision. `GET /session/:sessionID/execution-events` pages durable events from an epoch/sequence cursor. Root or invocation cancellation uses `POST .../cancel`; uncertain physical work uses `POST .../reconcile` with evidence and two CAS versions. The TUI refreshes this snapshot after a rejected prompt but leaves normal chat entry visible; uncertain mutating work still requires explicit reconciliation through the API before the server accepts a new turn. `/session/status` remains a backward-compatible transient busy/retry/idle view and must not be interpreted as a terminal outcome.

After changing `AtomBase/src/server/` routes, regenerate and build the SDK:

```sh
cd AtomBase
bun run dev generate > ../libs/sdk/js/openapi.json
cd ../libs/sdk/js
bun run build
```

Do not manually edit `libs/sdk/js/src/v2/gen/`; it is generated.

## Documentation maintenance

Treat documentation as part of the behavior change, not as a release-only cleanup. Update the canonical guide and the corresponding runtime guide reference together:

| Changed topic                      | Canonical documentation                        | Bundled guide reference                 |
| ---------------------------------- | ---------------------------------------------- | --------------------------------------- |
| Product overview or first run      | `README.md`                                    | `getting-started-and-tui.md`            |
| Configuration or permissions       | relevant guide plus schema examples            | `configuration.md`                      |
| Providers and models               | `docs/PROVIDERS.md`                            | `providers-and-models.md`               |
| Skills, agents, commands, or MCP   | `docs/SKILLS-GUIDE.md` / `docs/MCP-GUIDE.md`   | `extensions.md`                         |
| Server, attach, ACP, or Companion  | `companion/README.md` and relevant server docs | `server-and-companion.md`               |
| Troubleshooting and operations     | `README.md` or the owning package README       | `operations-and-troubleshooting.md`     |
| Contributor workflow and internals | `AGENTS.md`, `AtomBase/AGENTS.md`, this guide  | `development-and-contributing.md`       |
| HTTP API                           | route docs and generated SDK                   | only the relevant operational reference |

The bundled guide lives at `.atomcli/skills/atomcli-guide/`. Keep `SKILL.md` as a compact router and place detailed instructions in `references/`; loading the entrypoint should not flood every session with the whole manual. Its description must clearly distinguish AtomCLI product/development questions from ordinary coding tasks in repositories that merely use AtomCLI. Trigger words surface a candidate only—the agent still decides whether to load it.

Validate command examples with `atomcli --help` or `atomcli <command> --help`, configuration examples against `Config.Info`, and SDK claims against `libs/sdk/js/`. Check relative Markdown links, run `git diff --check`, and avoid hard-coded provider counts, model lists, ports that can be assigned dynamically, and package versions unless a release artifact requires them.

Do not update `RELEASE_NOTES.md` merely because documentation changed. Release notes and versioned statements belong to an explicitly requested release-preparation change.

### Bundled skill completeness

Every tracked skill under `.atomcli/skills/` is part of the default distribution. `AtomBase/script/build.ts` copies the tree into platform artifacts and release CI publishes verified `skills.tar.gz` and `skills.zip` archives. Installers copy a local checkout tree or verify and extract the release archive; they abort when the complete archive is unavailable instead of silently falling back to a partial skill set.

Skill loading retains bounded source/range/pending history through compaction and shows shortening. The durable root objective is included in every work turn; summary prompts preserve exact constraints, acceptance criteria, unresolved work, and checkpoint reasons. See [Skills Guide](SKILLS-GUIDE.md) for chunk budgets and recovery. Task-panel lifecycle projection also follows an ancestor execution snapshot for child sessions; completed steps remain complete even when overall execution is blocked.

### Completion and verification evidence

Normal completion and checkpoint final answers reject raw tool-protocol output. Text containing a serialized tool request is never executed as a substitute for an actual tool call. Fenced documentation examples remain supported. Protocol recovery is bounded; exhausted recovery produces a non-success report. An unfinished checkpoint with no subsequent tool activity prevents completion even when execution classification timed out and supplied no acceptance list.

Checkpoint `checks` is an optional, backward-compatible array of `{name, callID}` references. Run each acceptance command in its own Bash call. Runtime derives PASS/FAIL/BLOCKED from completed tool records, exit/timeout/abort metadata, an output fingerprint and a current Git-source snapshot. Shell command chains and pipelines do not prove individual subchecks. Changed or missing source evidence invalidates PASS. Nonzero exits fail; interrupted/unrun checks are blocked. For `grep`, distinguish no matches (exit 1) from an error (exit 2), rather than hiding both with `|| true`. Unreferenced `completedWork` remains self-reported; it is not independent verification. These checks establish command execution and source freshness, not the semantic truth of arbitrary prose or the correctness of a test's expectations.

Use `scope_control` with `action="status"` before diagnosing configuration or credential problems. Its diagnostics use the actual runtime paths and provider resolver, expose only credential-source presence/type, and do not probe provider access. Missing environment credentials or legacy config directories do not prove access unavailable. Never print raw config/auth records; preserve actual provider error classes, including quota failures.

For pre-push acceptance, compare regenerated SDK output against the SDK present at the start of the review; pre-existing uncommitted generated changes are not a freshness failure by themselves. Run live benchmark execution only in a separate Git copy containing all current commit candidates. Read `AtomBase/evals/README.md`; use the configured model and independent verifiers. An unavailable provider is BLOCKED, not PASS. Preserve the original worktree and report command exits/run IDs and unresolved checks.

Filesystem tools accept workspace-relative paths where documented; prefer them for local targets instead of rebuilding long absolute roots. Read reports its current workspace after a missing target; use `find` there to discover the exact file. A denied external path does not deny permitted discovery inside the workspace. Paths are never silently redirected, and permission checks remain binding.

Benchmark suite version 3 parses resumed records as JSON and checks every record's ID, name, email and numeric `schemaVersion: 2`, retaining completed-file hash checks. This replaces the whitespace-sensitive version 2 grep. Historical version 2 scores remain unchanged; cross-version results are not a controlled before/after comparison.

Evaluation counts a call routed to the `invalid` tool as a tool error even when that diagnostic tool has a completed status. Invalid arguments and unavailable tools cannot appear as zero-error execution. Existing error budgets remain unchanged.

An invalid-call diagnostic states that no action was applied and asks for corrected arguments. It does not label an available tool as unavailable solely because argument parsing failed, or suggest ending the task with text instead of repairing the call.

Suite version 4 replaces coordination prose keyword grading with an explicit authoritative JSON block in `VERDICT.md`. The public prompt specifies every required field: full-log metric/value/population/sample size/nearest-rank position, accepted and rejected source paths, the rejected source's stated value/sample size and whether that claim applies to the full log. Free prose has no synonym requirement. Verification independently recomputes p99 and checks the JSON types and values; setup hashes protect both evidence files and the raw log. A prose mention of the right number cannot rescue an incorrect structured verdict. Historical version 2/3 results retain their original scores; version 4 changes one task's output contract and is not a controlled comparison with them. Tool-error/retry budgets and timeouts are unchanged.

Suite version 5 uses `grading: "outcome-v2"`: verified successful final work passes despite recovered tool errors or retries. Above the existing allowances, each tool error costs 2 points (cap 10), each retry 1 point (cap 5); exceeding the soft `maxDurationMs` target costs `min(5, ceil((durationMs / maxDurationMs - 1) * 5))`. A passing case scores 80–100; failed/unobserved cases score 0. Aggregate `score` averages all cases; `accepted` requires every case to pass and controls live CLI exit, while `ready` only indicates observation coverage. Missing/failed independent verification, unsuccessful/incomplete execution, missing required tools, failed required tests and the hard `timeoutMs` watchdog remain blocking. Two excess tool errors with correct verified output therefore pass at 96/100. Custom suites default to historical `strict-v1`; opt in explicitly. Policy buckets are separate; old grades remain intact. Prompts, fixtures, verifier assertions, allowances and timeouts are unchanged. A grading change alone is not a model-quality improvement. See `AtomBase/evals/README.md` for report semantics.

Browser integration fixtures explicitly focus the page before requesting pointer lock and bound both acquisition and release waits. Browser tools restore desktop focus; a background document cannot be assumed eligible for pointer lock. CI installs the pinned Chromium runtime and runs the opt-in browser suite explicitly.

Linux CI and release jobs run `.github/scripts/setup-linux-sandbox.sh` before tests. On Ubuntu with restricted unprivileged user namespaces, it grants the installed bubblewrap launcher an explicit AppArmor user-namespace policy, preserving the host-wide restriction. An actual unprivileged UID/PID namespace probe must pass; sandbox tests and product enforcement are never bypassed.
