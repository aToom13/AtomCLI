# AtomCLI v3.4.3

AtomCLI 3.4.3 focuses on verified model routing, durable execution recovery, session integrity, and a more reliable beta Companion workflow. Companion remains a beta product under active development: mobile behavior, protocol capabilities, background execution, and platform integrations may change in later releases. Local-network access is intended for trusted networks; Tailscale remains the recommended remote path.

## Verified Auto and Free Routing

- Changed AtomCLI Auto and AtomCLI Free to select concrete routes only after capability-specific verification with the effective endpoint, credentials, adapter parameters, and reasoning variant.
- Kept AtomCLI Free restricted to explicitly zero-cost routes across retries, fallback, helper calls, and child sessions; unknown pricing is not treated as free.
- Added separate opt-ins for paid Auto routes and paid verification probes so model discovery cannot silently incur cost.
- Added bounded text and tool-call probes, expiring evidence, cooldowns, and visible failures when no verified route is currently eligible.
- Fixed ChatGPT OAuth verification to use the streaming Responses path required by normal dispatch.
- Preserved root union tool schemas while supplying the object metadata required by stricter providers.

## Adaptive Model Control and TUI

- Added the `model_control` tool for connected-model discovery and explicit model, reasoning, or bounded expert-route proposals.
- Added independent `off`, `ask`, and `auto` policies for model and reasoning recommendations. Automatic application requires an exact trusted grant and a safe execution boundary.
- Added adaptive routing controls under the model slash-command tree and Ctrl+P model settings, including direct Auto and Free selection.
- Kept manual model and reasoning choices pinned above later automatic proposals.
- Added visible route, reasoning, stage, pin, and execution-call information near the prompt.
- Fixed Ctrl+C confirmation navigation with arrow keys and H/J/K/L while retaining Cancel as the safe default.
- Made rejected prompts and uncertain transport acknowledgements visible without automatically resending potentially side-effecting requests.

## Durable Execution and Recovery

- Added a SQLite/WAL execution ledger with persistent call, step, duration, execution-cost, session-cost, and project-cost admission.
- Added renewable owner leases, monotonic fencing, takeover recovery, exact cancellation targets, and conservative accounting for dispatched requests whose result is unknown.
- Added durable work and blocker records for tools, child sessions, workflows, taskflow plans, verification, and review obligations.
- Bound completion candidates to workspace mutation, plan, review-policy, and streamed-content revisions so stale review results cannot commit newer work.
- Added immutable completed, failed, cancelled, budget-exhausted, and review-blocked outcomes with restart-safe delivery projection.
- Added bounded completion recovery, projector leases and tokens, session-generation checks, and visible recovery-required records for invalid or missing projection targets.
- Added session-scoped execution list, detail, snapshot, event replay, cancellation, and unknown-work reconciliation endpoints.
- Bounded global and instance SSE queues by event count and bytes and cleaned up subscribers on abort, overflow, and write failure.

## Session and Storage Integrity

- Added a SQLite/WAL storage manifest, content-addressed records, cross-process compare-and-swap updates, session tombstones, and cache revision checks.
- Added verified cutover backups and lazy legacy migration recovery without silently discarding malformed records.
- Preserved cumulative budgets and the original deadline when a terminal execution is explicitly resumed.
- Fixed retry exhaustion, stale run cleanup, final-step tool disabling, and workflow double-execution ownership.
- Rejected empty, unfinished, or non-shrinking compaction summaries before hiding older context.
- Preserved completed tool evidence when a later provider or post-processing failure occurs and prevented unsafe automatic replay of already-applied operations.
- Added bounded base64 and percent-encoded text data URL decoding.
- Moved session-bound memory work behind the main response and accounted helper model calls against the same execution budget.

## Companion Beta

- Started the Companion listener alongside normal TUI startup when paired-device state or explicit options require it, without reserving the preferred port for an unnecessary control listener.
- Preserved the invoking project directory when the root development wrapper starts AtomBase, preventing saved Companion endpoints from appearing to belong to another project.
- Kept automatic port fallback for normal startup while making explicit Companion port collisions fail visibly.
- Added durable execution events and terminal outcomes to the Companion protocol and mobile state.
- Added encrypted local cache records, a bounded plain-text safe outbox, bridge-epoch checks, and idempotent delivery handling.
- Improved provider failure cards, connection diagnostics, optimistic message recovery, and cached-state labeling.
- Kept authentication, permission decisions, stop controls, session creation, and temporary attachments outside offline replay.

## API, SDK, ACP, and PTY

- Regenerated the JavaScript SDK for the execution lifecycle and replay endpoints.
- Mapped durable terminal outcomes to ACP stop reasons and tightened ACP authentication handling.
- Added cleanup coverage for PTY subscribers and bounded retained shell output to the newest 2 MiB.
- Updated canonical documentation and the bundled AtomCLI guide for the new routing, execution, storage, TUI, and Companion behavior.

## Validation

- Workspace and AtomBase typechecks passed.
- The fixture-backed AtomBase suite passed 1,617 tests with 10 opt-in tests skipped and no failures.
- Workspace Turbo tests, generated SDK checks, Companion protocol generation checks, bundled-guide tests, formatting checks, and repository hygiene checks passed.
- Live provider checks and physical-device behavior remain opt-in and environment-dependent.

Version `3.4.3` is stable AtomCLI release metadata; the exact release tag is `v3.4.3`. Companion remains beta.
