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

## Package and test commands

From the monorepo root:

```sh
bun install --frozen-lockfile
bun run dev
bun turbo typecheck
bun turbo test
```

The root `bun run dev` wrapper loads the CLI from `AtomBase/` while preserving the monorepo root as the active project directory.

From `AtomBase/`:

```sh
bun run dev
bun run typecheck
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json bun test
```

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

The edit tool's fuzzy matching and failure behavior are deliberate. Preserve its fallback chain and never turn a failed match into a silent no-op.

## Agents and orchestration

- Native agents are defined in the state factory in `AtomBase/src/integrations/agent/agent.ts`.
- User agent Markdown files extend or override native agents; they do not replace the native registry wholesale.
- The orchestration session-map key format is `parentSessionId:agentType:taskId`. Changing it breaks workflow cleanup.
- The workflows map is bounded to 100 entries and has one-hour TTL cleanup. Do not remove those bounds.
- Orchestrated subagents must always be denied `todowrite`, `todoread`, and `task` permissions.
- Session cleanup is owner-scoped: an older run must not cancel a replacement run for the same session.
- An exhausted model retry budget is terminal. It must not wait, select another fallback, or issue another model call.
- The final configured agent step receives the maximum-step instruction with an empty tool set.
- A workflow can have only one live `execute` owner. A stopped checkpoint is resumable; a concurrent execute request reports the existing run instead of resetting its tasks.
- Optional `execution_budget` limits use a persistent SQLite/WAL ledger. A root request and its child sessions share atomic model-call, agent-step, duration, and cost admission; dispatched calls whose outcome is unknown remain conservatively charged after restart. Verification probes keep the originating execution context and abort when the caller, deadline, or execution lease is cancelled.
- A prompt can resume a terminal execution by sending `resumesExecutionID`. Resume creates a linked segment but retains the prior `budgetScopeID`, cumulative calls, steps, cost, and original deadline; it can tighten limits but cannot reset or extend them.
- Normal prompt cleanup is distinct from user cancellation. Cancellation targets the captured execution/fence, so delayed cleanup cannot cancel a newer user turn or shared parent/child execution.
- Structured-output contracts are appended at the shared subagent spawn boundary. Reviewer slots persist across retries, an unchanged revision reuses its fresh PASS, and task QA uses the configured reviewer count and review attempt limit while passing findings into worker retries. Reviewer infrastructure failures retry review without repeating completed worker side effects. Successful completion clears root and descendant review state; recovery restores patches only from the current non-synthetic user turn.
- Review-required completion uses a persistent claim bound to each concrete reviewer child session and needs a matching persisted passing verdict for the exact digest and mutation revision. Reviewer/checker names alone do not grant finalizing access.
- Completion candidates also bind the current plan revision, versioned review-policy digest, and a streaming content snapshot digest. Policy skip is a distinct `not_required` decision, never a reviewer PASS. A stale policy, plan, mutation, or content snapshot cannot commit.
- When required review is unavailable or exhausts its attempts, the private candidate keeps its review requirement. A separate safe delivery is committed with immutable execution outcome `blocked`; the candidate is never downgraded to `requiresReview: false` or reported as completed. Retryable review findings still use the bounded continuation outbox.
- Terminal success and failure share an immutable execution outcome boundary. `completed`, `failed`, `cancelled`, `budget_exhausted`, and review `blocked` write a fixed delivery outbox and redacted, versioned execution event atomically. Explicit root cancellation has a fixed local delivery even before an assistant message exists; child-only cancellation leaves the root active. Projection claims use a short lease and token, all storage writes use the exact session generation, and ACK requires the same digest, generation, owner, and token. Invalid payloads or missing target messages become visible `recovery_required` records rather than retrying forever. Terminal `finish` and `time.completed` are not made visible before that commit, and a late or stale projection cannot make an older terminal execution active again.
- Session-scoped execution list/detail/snapshot/replay APIs expose this redacted record, including unresolved mutating work IDs and CAS versions. Snapshot state and cursor share one ledger transaction. Cancel and unknown-work reconciliation use idempotent request IDs and exact execution-version CAS; reconciliation also requires exact work version and bounded evidence. Stale/conflicting requests do not mutate state. `/session/status` remains transient busy/retry/idle compatibility state, not proof of success.
- Durable execution cursor, transient global SSE cursor, and Companion bridge cursor are separate domains. Epoch changes, ahead cursors, or retention/buffer gaps require snapshot resynchronization. Budget and blocker changes advance resource versions; 80% and 100% cost warnings are emitted once per configured scope and policy version. Global and instance SSE queues are bounded to 256 pending events or 2 MiB and release subscribers/timers on abort, overflow, and write failure.
- Session deletion carries the tombstone generation into an idempotent `execution.deleted` event, preserves an already selected outcome, and does not emit another deletion transition when retried.
- Tool work remains open through permission, around/after hooks, plugin processing, and result replay. Ownership is checked at the tool-body boundary. A takeover marks abandoned running work unknown; the stale owner cannot finish it and the new fenced owner must explicitly reconcile it before completion. Unknown mutating work blocks a new root prompt, but stale root invocations with no such work are closed by the next atomic bind. A rejected bind leaves only a terminal `failed/recovery_required` execution, and synthetic review continuation binding closes the prior invocation without leaving the execution budget.
- Child, workflow, taskflow-plan, and verification obligations are durable blockers. Only resolved blockers or an authorized, reasoned waiver satisfy the success gate; clearing a visual task list does not silently resolve work.
- Owner leases are renewed by a shared execution-lifetime controller while root, child, model, review, or tool work holds the execution. Persistent cancellation or lease loss aborts the shared signal. Rejected-review retries use a bounded persistent continuation outbox so a crash between the ledger decision and session projection cannot lose the retry or create a fresh budget scope.
- Tool work is admitted persistently after permission but before invocation. Mutating tool admission dirties the revision before any side effect; duplicate operation IDs are rejected, and running or unknown operations block final staging/commit instead of being guessed complete after restart.
- Session-bound verification, retry/fallback, review, compaction, and memory calls consume the same ledger. Background memory work runs after the main response so it cannot take the first reservation.

Treat permission changes as security-sensitive and cover them with focused tests.

Live agent comparisons use the same versioned eval fixtures with `eval benchmark --execute --routing fixed-base|fixed-expert|adaptive`; fixed-expert requires `--expert-model`. Reports distinguish calls, expert episodes, unpriced calls, TTFT/total time, proposals/rejections/repeated questions, and returns to base. These runs consume provider quota, and fixture-backed harness tests are not live model verification.

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

The tag workflow also analyzes and tests the Flutter Companion, then attaches a signed `atomcli-companion-android.apk` to the checksum-covered release assets. Published APKs require the persistent repository secrets `ATOMCLI_ANDROID_KEYSTORE_BASE64`, `ATOMCLI_ANDROID_KEYSTORE_PASSWORD`, `ATOMCLI_ANDROID_KEY_ALIAS`, and `ATOMCLI_ANDROID_KEY_PASSWORD`; the workflow must fail rather than publish a debug-signed APK when they are absent. Local debug-key release builds are for device testing only. Never commit an Android keystore or its passwords.

## Definition of done

For an ordinary AtomBase change:

1. `bun run typecheck` passes from `AtomBase/`.
2. Focused regression tests pass with the models fixture when provider code may load.
3. The full AtomBase suite passes, or root `bun turbo test` passes for cross-package changes.
4. Formatting and `git diff --check` pass.
5. Generated SDK state is correct if the server API changed.
6. `git status --short` contains only intended files.
7. Canonical docs and the matching bundled guide reference reflect user-visible behavior.
8. The handoff reports what changed, what was validated, and any unresolved failure without claiming success prematurely.
