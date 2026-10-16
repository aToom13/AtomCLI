# AtomCLI v3.4.5

AtomCLI 3.4.5 delivers a durable execution architecture, deterministic verification, modular session processing, provider runtime improvements, and a synchronized Companion and SDK surface. Companion remains a beta product under active development; Android, iOS, background execution, and OEM integrations are not universally stable.

## Execution Ledger, Atomic Work, and Recovery

- Added a 17-module persistent execution ledger under `AtomBase/src/core/execution/ledger/` for admission, lifecycle, checkpoints, tasks, work, completion, cancellation, projections, queries, routes, policy state, schema, bindings, and execution views.
- Added renewable ownership leases and fencing in `lease.ts`, including expired-owner takeover, reservation reclamation, and protection against stale processes finishing work.
- Added orphaned-work recovery, explicit reconciliation for uncertain mutations, durable checkpoints, review claims, and idempotent projection into session storage after restart.
- Added the `atomic_work` tool and atomic plan records so decomposition, dependencies, ownership, and criterion-level verification are persisted together.
- Added `task-verification.ts`, `scope_control`, and `scope-floor.ts` so completion requires evidence and delegated work stays within the authorized scope.

## Deterministic Static Gate and Repair Planner

- Added `StaticGate` and the `static_check` tool for deterministic full-source checks across JavaScript, TypeScript, TSX, and HTML.
- The gate detects undefined symbols (`no-undef`) and redeclarations (`no-redeclare`) with stable diagnostics and bounded output.
- Added `RepairPlanner`, which walks nested `error.cause` chains and converts verification failures into ordered, bounded repair actions.

## Modular Session Prompt Pipeline and Compaction

- Rebuilt the session prompt pipeline as focused modules for `turn-execution`, `checkpoint`, `completion`, `finalization`, `reminders`, `context`, `route`, and `tools`, alongside command, task, shell, title, and user-message stages.
- Added `compaction-policy` and `compaction-transaction` so compaction is budgeted, reviewable, and recoverable.
- Added UTF-8-safe `truncateUtf8` handling in `HarnessState`; multi-byte characters remain valid when context is truncated.
- Added scope-aware prompt guidance, checkpoint handoffs, replay support, and completion recovery across long-running sessions.

## Provider Catalog, Model Selection, and Runtime Verification

- Split provider resolution into `bundled`, `catalog-auth`, `catalog-config`, `catalog-filter`, `custom-loaders`, `model-selection`, `models-runtime`, `schema`, and `verification` modules.
- Added runtime catalog refresh, provider variants, capability-aware model selection, custom provider loaders, and explicit pricing and access classification.
- Preserved OAuth free-model filtering while supporting current Cline Pass API-token catalogs and aliases.

## Tools, TUI, and CLI Architecture

- Modularized `orchestrate/*` and `browser/*` runtimes, including lifecycle, ownership, dependencies, recovery, input sequencing, schema, and validation.
- Added `todo-tool`, `task-dispatch`, `atomic_work`, `static_check`, and scope-control tooling with schema-validated results.
- Added TUI dialogs for directory picking, execution recovery, and skill discovery.
- Split prompt handling into `prompt/commands`, `prompt/paste`, and `prompt/status`; split theme support into `theme/syntax` and `theme/system`.
- Added resilient session scrolling, delivery states, recovery flows, task lifecycle rendering, and directory-scoped prompt history.

## Server, OpenAPI v2 SDK, and Companion

- Modularized the Companion server bridge under `AtomBase/src/server/companion/` for pairing, state, actions, directory access, messages, snapshots, and uploads.
- Added the Flutter/Dart Companion models, providers, screens, and services under `companion/lib/models/`, `companion/lib/providers/`, `companion/lib/screens/`, and `companion/lib/services/`.
- Synchronized the OpenAPI v2 SDK in `libs/sdk/js/src/v2/gen/` with the server contract.
- Companion remains beta; mobile behavior, protocol capabilities, background execution, and OEM integrations may change between releases.

## Bundled Skills, Documentation, and Installers

- Expanded bundled skill packages and focused references under `.atomcli/skills/*`.
- Added the `docs/ATOMIC-WORK.md` specification and refreshed the development, provider, review, MCP, skills, and documentation-index guides.
- Improved `install.sh` and `install.ps1` dependency checks, baseline binary selection, retries, checksum validation, PowerShell 5.1 behavior, Bun setup, Chromium verification, and installed-binary checks.

## Validation

- `bun run version:check` passed for version `3.4.5`.
- `bun run typecheck` passed with `tsgo --noEmit` and 0 errors.
- `StaticGate` scanned 614 source files with 0 false positives.
- AtomBase tests passed: 2,258 passed, 13 skipped, 0 failed across 230 files.
- Bundled guide, installer, Companion protocol, and generated SDK checks passed in the release validation path.

Version `3.4.5` is released only by pushing the exact `v3.4.5` tag.
