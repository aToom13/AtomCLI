# Development Guide

## Requirements

- Bun 1.3.14
- Git

Use Bun only; this repository does not use npm or Yarn. The monorepo root delegates workspace tasks, while the primary application package is `AtomBase/`.

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

Prefer behavior-level tests over implementation-only assertions. A regression test should exercise the public boundary that failed, use an isolated temporary project when filesystem or Git state matters, and assert an observable result. Provider unit tests may mock transport, but live provider probes must remain explicitly opt-in and must distinguish rate limits from compatibility failures.

### Storage cutover and recovery

AtomCLI storage uses a SQLite/WAL manifest whose revisions point at immutable, content-addressed JSON blobs. `Storage.update` uses bounded compare-and-swap retries, so two current AtomCLI processes cannot silently overwrite the same read-modify-write operation. Reads validate their cached revision against the manifest; deletes leave a tombstone, preventing old JSON files or stale caches from recreating a deleted record.

Session records have a durable generation guard. Creating or importing a session activates its generation; deletion first increments and tombstones that generation, then abandons pending completion projections and purges transcript namespaces. Message and part writes and removals validate the generation in the same manifest transaction, so a late stream or projector callback cannot recreate or mutate deleted content. Projection recovery treats an existing tombstone as an idempotent abandonment and scans committed deliveries in bounded pages of 50 instead of failing when more than 100 are waiting. Accounting may remain in the execution ledger, but deleted transcript payloads are not restored from it.

Before the first manifest cutover, AtomCLI creates and verifies `~/.atomcli/data/storage-backups/cutover-v1`. This backup contains the original JSON records and a SHA-256 manifest; credentials outside the storage tree are not included. Corrupt legacy JSON is retained byte-for-byte for recovery and appears as an unreadable record instead of being discarded. Restore tooling must run `StorageBackup.restore(..., dryRun: true)` first and restore into an empty destination; publication occurs through a verified staging directory so an interrupted copy does not replace the destination.

An interrupted cutover does not rescan and hash the entire legacy tree during every startup. Existing manifest keys open immediately; missing legacy records and list prefixes are imported on demand. A new cutover records completion only after the full initial import, so a crash cannot hide records and tombstones still take precedence over legacy files.

Use `test/core/storage-manifest.test.ts`, `test/core/storage-backup.test.ts`, and `test/core/storage-migration.test.ts` when changing this boundary. The manifest format check intentionally rejects a database written by a newer AtomCLI binary.

When the bundled AtomCLI guide changes, validate its frontmatter, reference paths, development coverage, and runtime discovery:

```sh
cd AtomBase
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json bun test test/skill/atomcli-guide.test.ts
bun run --conditions=browser ./src/index.ts skill list
bun run --conditions=browser ./src/index.ts skill show atomcli-guide
```

The `eval benchmark` command measures model-driven agent behavior and is not part of the deterministic validation commands above. Without `--execute` it only reports stored observations. With `--execute`, every case materializes its own fixture into the workspace, prompts the selected agent under a hard per-case timeout, and is then graded by an independent verifier before all changes are reverted. Verifier sources are moved out of the worktree for the duration of a run and restored automatically, including after interruption. On an interactive terminal the command offers provider, model, and agent menus unless `--model` is given. Use `--routing fixed-base|fixed-expert|adaptive`; fixed-expert requires `--expert-model`, while adaptive may use it as the bounded expert candidate. The same versioned fixtures report route calls, expert episodes, unpriced calls, TTFT, proposals/rejections/repeated questions, and base returns. Executing the benchmark contacts the selected provider, consumes quota, and takes minutes per case. Fixture results are not live provider verification. See `AtomBase/evals/README.md`.

## Build and release

```sh
cd AtomBase
bun run build
```

`AtomBase/script/build.ts` removes `dist/` before each build, bundles the application for supported targets, and includes root `.atomcli/` and `.claude/` assets. Do not store source files in `dist/`.

Pushing a `v*` Git tag is the only automated release trigger. This repository does not track a release helper script; maintainers may use an ignored local helper, but must not manually publish generated release directories.

Release jobs run from a clean checkout. The build copies root `.atomcli/` and `.claude/` directories, so only tracked, reviewable skills and agents belong there. Local configuration, credentials, package manifests/locks, installed dependencies, plans, runs, and session state must remain ignored.

The build matrix produces Linux x64/ARM64 (glibc and musl), macOS x64/ARM64, and Windows x64/ARM64 executables. Alpine runtimes for the musl builds must provide `libstdc++` and `libgcc`; the release installer and platform smoke workflow install these packages. x64 baseline variants cover older processors without AVX2. Stable GitHub releases also build, test, sign, checksum, and attach `atomcli-companion-android.apk`. Bun has no FreeBSD runtime or compile target, so FreeBSD cannot be advertised as a supported AtomCLI runtime; platform-specific helpers should still fail clearly or use a system executable where possible.

The published Android APK must use one persistent signing identity so users can install later releases as upgrades. Configure the repository secrets `ATOMCLI_ANDROID_KEYSTORE_BASE64`, `ATOMCLI_ANDROID_KEYSTORE_PASSWORD`, `ATOMCLI_ANDROID_KEY_ALIAS`, and `ATOMCLI_ANDROID_KEY_PASSWORD`; the tag workflow fails before building the APK when any value is missing. The keystore itself must never be committed. A local `flutter build apk --release` without these environment variables deliberately uses the debug identity for device testing only and must not be distributed.

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
- Only one live `execute` call may own a workflow. A checkpoint whose process stopped can be resumed, while a second call against a currently owned workflow reports that it is already running.
- A compaction summary becomes a history boundary only after its linked transaction is committed. Empty, whitespace-only, unfinished, and non-shrinking summaries are rejected without hiding the prior context.
- A completed tool call/result remains in model history even if the provider fails later in the same assistant turn. Tool replay records distinguish an execution failure from an operation that completed before post-processing failed; the latter must not be retried automatically.
- Optional `execution_budget` limits are snapshotted into a SQLite/WAL ledger per explicit root user turn. Root and child invocations keep an explicit persistent execution binding. Calls and steps use the execution scope, while root-session-tree and project cost totals remain distinct; every configured scope is admitted atomically. Dispatch rechecks the fence and deadline, and dispatched calls with unknown outcomes remain charged as uncertain across restart until late usage settles them. Verification probes retain the originating execution context and combine caller, deadline, and execution-lease abort signals.
- Resuming a terminal execution uses the prompt's optional `resumesExecutionID` and creates a new execution segment linked to the prior one. Segments share `budgetScopeID`, cumulative calls, steps, cost, and the original deadline; a resumed policy may tighten but cannot extend those limits.
- Verification probes and auxiliary review, compaction, and memory requests belong to the same execution budget. Auxiliary memory learning starts only after the main response so it cannot win the initial reservation race.
- Executions use renewable owner leases and monotonic fencing. A reference-counted execution-lifetime controller renews ownership across model, review, and tool work; cancellation or lease loss aborts the shared signal and therefore the active stream/tool path. Takeover is allowed only after lease expiry; it releases reservations that the old fence never dispatched, while the stale owner cannot claim steps, reserve or dispatch calls, invoke a tool, or commit a final candidate. Late usage may still settle work dispatched before takeover.
- Cancellation is a persistent execution state, not only an in-memory abort. Review and child-agent work receive the parent abort signal, and tool execution rechecks execution ownership immediately before invocation. A tool that applied a side effect before bookkeeping failed is still reported as applied and must not be retried automatically.
- Structured-output contracts are appended at the shared subagent spawn boundary. Reviewer slots persist across retries, a fresh PASS is reused only for the unchanged review revision, and task QA uses the configured reviewer count and review attempt limit while passing rejection details into worker retries. Reviewer infrastructure failures retry reviewers without repeating completed worker side effects. Successful completion clears review state for the root and descendants; crash recovery restores patch evidence only from the current non-synthetic user turn.
- Tool middleware writes a bounded, owner/fence-bound work record after permission and immediately before invocation. Workspace-mutating tools dirty the persistent mutation revision at admission, before a side effect can race completion; duplicate operation IDs are rejected. Running or unknown work blocks staging and commit. A mutating invocation that throws remains unknown because partial side effects cannot be ruled out automatically.
- Root terminal text is never persisted as public text or a terminal `finish` before the completion decision. The bounded candidate and digest are bound to the review files, mutation revision, plan revision, versioned review-policy digest, and a streaming content snapshot digest. Staging enters `finalizing`, where normal model work is rejected. Reviewer/checker access requires a persistent review claim bound to the concrete child session; a review-required candidate cannot commit without a matching persisted `passed` verdict. A policy decision that review is not required is recorded separately and is never represented as reviewer PASS. Commit rechecks the current policy/content/plan snapshots, fenced owner, and durable work/blockers in one ledger transaction.
- A retryable review rejection atomically discards its candidate, binds the retry invocation, and writes a bounded continuation outbox record before session projection. If required review is unavailable or its bounded attempts are exhausted, the original candidate remains review-required and private: the ledger atomically records terminal outcome `blocked` and a separate safe delivery payload. It must never restage the candidate with `requiresReview: false` or report `completed`. Execution lifecycle, phase, immutable terminal outcome, safe reason, and resource version are persisted independently; public execution/event consumers are built on that record rather than interpreting `SessionStatus.idle` as success.
- Root success and terminal failure delivery use the same durable boundary. `completed`, `failed`, `cancelled`, `budget_exhausted`, and review `blocked` outcomes are immutable; provider/model errors map to allowlisted, redacted reason codes. The terminal outcome, fixed delivery outbox, and versioned `execution.updated` event are written in one ledger transaction. Explicit root cancellation also stages a fixed local message/part delivery, including when no assistant message existed yet; child-only cancellation does not terminalize the root. A projector must claim each delivery with a short lease and opaque token, write every message/part under the exact session generation, and ACK with the same digest, generation, owner, and token. A takeover invalidates the stale projector, while an ACK retry by the winning token is idempotent. An invalid payload or missing target message is fenced into visible `recovery_required` state instead of entering an unbounded retry loop. Processor and model-resolution failures do not expose terminal `finish` or `time.completed` before this commit.
- Public execution state is available through the session-scoped list, detail, snapshot, replay, cancel, and reconcile endpoints. Execution views expose redacted `unknownWork` operation IDs and CAS versions, including unresolved work on terminal executions. List cursors are opaque and tied to the root session and database epoch. Snapshot state and its durable cursor come from one ledger transaction. Cancellation and reconciliation require a caller request ID plus exact execution version; reconciliation additionally requires the exact unknown-work version and bounded evidence. Duplicate request IDs are idempotent, while stale or conflicting requests fail without changing state.
- Durable execution replay returns `resyncRequired` for an epoch change, cursor-ahead request, or retention gap. Budget reservation, dispatch, uncertain/settled usage, and late actual usage advance the execution resource version; configured cost scopes emit durable 80% and 100% warnings once per scope and policy version. Blocker creation and CAS transitions likewise emit versioned `execution.blocker.updated` events. The transient `/global/event` stream has a separate process epoch and emits `server.resync_required` for legacy cursors, process changes, future cursors, or its bounded replay gap. It must not be confused with the durable execution cursor or Companion bridge cursor. Global and instance SSE writers allow at most 256 pending events or 2 MiB per client and clean up the subscriber and heartbeat on abort, overflow, or write failure.
- Session deletion carries its new generation into an idempotent `execution.deleted` event, abandons pending delivery, and never overwrites an already selected terminal outcome. Repeating deletion creates no new event. A terminal execution is excluded from active-session inheritance even if its compatibility pointer has not yet been cleaned up.
- A takeover marks abandoned running work `unknown`; the stale fence cannot finish it and the new owner must explicitly reconcile it. Unknown mutating work blocks a new root prompt, while stale root invocations with no unknown work are closed during the next atomic bind. Startup recovery also completes expired legacy auxiliary invocations with no open work. A rejected bind terminalizes its otherwise-empty execution as `failed/recovery_required` instead of leaving an active record. Synthetic review continuations replace their prior invocation inside the same bind transaction and retain the execution budget. Tool ownership is rechecked after permission and around middleware at the actual tool-body boundary, and the work record stays open through after hooks and result replay. Filesystem permission failures before an edit or write reaches disk, and browser target timeouts that occur while still waiting for a locator, are recorded as not applied so the agent can choose another strategy without forcing unknown-work recovery. Reconciliation never cancels the execution: active work continues, while abandoned invocation state is retired by the next atomic prompt bind. Taskflow items, workflows, children, and verification jobs use durable blockers; only `resolved` or explicitly authorized/reasoned `waived` blockers satisfy the success gate. Ordinary prompt cleanup does not call the explicit cancellation path. Terminal executions reject new work while still allowing committed projection recovery and late usage settlement. Session projection is idempotent, so restart recovery can finish a committed delivery without rerunning the model.
- Tool argument validation and rejected permission checks are recorded as not applied, even when permission is requested from inside a tool body. Tools may classify mutation per operation: LSP queries, browser inspection actions, system health checks, and agent status/wait calls remain read-only, while their state-changing variants retain unknown-work protection. Edit/write validation failures before the filesystem call do not enter recovery; failures after a confirmed write are marked applied. LSP diagnostics after edit/write are best-effort and bounded to two seconds so successful filesystem changes cannot leave a tool hanging.
- Text attachments supplied as data URLs are decoded from the payload only. Base64 and percent-encoded UTF-8 are supported, malformed input is rejected, and decoded text is limited to 1 MiB.

Cover changes to these paths with deterministic retry, continuation binding, abort ownership, stale-fence tool admission, finalizing dispatch, mutation-during-review, terminal reserve rejection, workflow ownership, compaction commit, tool-evidence, and attachment-decoding tests.

## Server API and SDK

`GET /session/:sessionID/executions`, `GET /session/:sessionID/executions/:executionID`, and `GET /session/:sessionID/execution-snapshot` expose redacted durable execution state, including `unknownWork` records that need a user decision. `GET /session/:sessionID/execution-events` pages durable events from an epoch/sequence cursor. Root or invocation cancellation uses `POST .../cancel`; uncertain physical work uses `POST .../reconcile` with evidence and two CAS versions. The TUI refreshes this snapshot after a rejected prompt, disables prompt entry while unknown work exists, and records one of two fixed user decisions without resending the prompt. `/session/status` remains a backward-compatible transient busy/retry/idle view and must not be interpreted as a terminal outcome.

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
