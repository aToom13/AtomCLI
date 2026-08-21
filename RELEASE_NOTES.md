# AtomCLI v3.3.9-debug2

AtomCLI v3.3.9-debug2 is a diagnostic build focused on long-session stability, agent workflows, model and provider handling, terminal interaction, evaluation, and regression coverage.

## Debug2 stability updates

- Fixed excessive memory growth in long-running sessions with very large generated file sets.
- Bounded snapshot manifests, diff content, and the storage read cache.
- Kept operational patch data out of normal model history, terminal history, sharing, and export flows.
- Added regression coverage for large snapshots, legacy patch records, safe revert behavior, and repeated long-session loading.

## Debug build updates

- Reduced hidden provider calls during prompt preparation, memory learning, title generation, and session summaries.
- Limited automatic memory learning to explicit, durable user information while retaining relevant memory recall.
- Improved provider catalog synchronization and request-time model detection for shared provider clients.
- Connected model-specific thinking levels to real provider request options and preserved the level used by each response.
- Added regression coverage for prompt latency, MCP startup, memory signals, provider model selection, and thinking controls.

## Agent workflows and context

- Added task-aware model routing that considers required tools, browser use, vision, planning, risk, context size, prior model quality, and tool reliability.
- Improved shared workflow evidence, conflict reporting, repair guidance, change-impact analysis, and review policy selection.
- Added a semantic project map so repository inspection can prioritize relevant files, symbols, imports, and tests without broad file dumping.
- Improved automatic session evaluation while keeping benchmark sessions isolated from model fallback, auxiliary summaries, memory learning, and normal retries.
- Updated semantic memory learning to use the model selected for the active session instead of a separate hard-coded model.

## Evaluation and regression testing

- Added reproducible benchmark suites, isolated per-case execution, rate-limit detection, progress counters, and durable reports.
- Strengthened benchmark schema validation so duplicate case identifiers cannot alias observations.
- Expanded tests for real session-derived signals, including tool calls, test outcomes, review verdicts, retries, tokens, duration, concurrent capture, and failed validation commands.
- Added coverage for same-size project file changes, deleted files, staged and untracked diffs, symlink boundaries, binary and oversized artifacts, tool reliability scoring, and rate-limit progress output.
- Improved thinking-level tests so the terminal only offers variants supported by the selected model and rejects unsupported levels instead of reporting false success.

## Terminal interface

- Improved task-plan sizing, scrolling, hit testing, autocomplete placement, and narrow-terminal behavior.
- Reduced unnecessary virtual-list polling and improved mouse selection behavior for nested command menus.
- Prevented the startup artwork from obscuring slash-command results.
- Added clearer benchmark progress with the active case, attempted-case count, elapsed case time, total elapsed time, errors, and rate-limit termination.

## Providers and model behavior

- Improved provider compatibility checks, model availability tracking, rate-limit labels, and automatic recovery timing.
- Kept rate-limited models visible while excluding them from automatic routing until their retry window expires.
- Prevented benchmark fallback from silently measuring a different model than the one requested.
- Ensured configurable thinking levels are derived from the active model rather than a global static list.

## Validation

- AtomBase typechecking and the complete Bun test suite pass with the pinned models fixture.
- Workspace typechecking and tests pass through Turbo.
- Release hygiene checks report no tracked files hidden by ignore rules.
