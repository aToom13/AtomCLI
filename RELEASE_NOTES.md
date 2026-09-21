# AtomCLI v3.4.4

AtomCLI 3.4.4 adds durable adaptive execution, stronger recovery and verification controls, improved provider compatibility, and stable long-session transcript scrolling. Companion remains a beta product under active development; Android, iOS, background execution, and OEM integrations are not universally stable.

## Adaptive Execution

- Added default adaptive execution pipelines for direct, focused, and coordinated work, with conservative agent-specific defaults when semantic classification is disabled.
- Added optional model-based semantic classification through `experimental.execution_classification`, charged against the active execution budget.
- Added durable tool-free checkpoints, bounded slice extensions, semantic loop detection, immutable plan revisions, and user-visible finalization when work cannot safely continue.
- Preserved execution objectives, plans, allowances, and durable blockers across compaction, restart, user-input waits, and linked resume segments.
- Required coordinated work to establish durable taskflow state before normal tools run and prevented independent review steps from completing without reviewer evidence.

## Reliability and Safety

- Recorded mutating work admission and outcomes durably so restart recovery can distinguish applied, not-applied, and unknown operations.
- Prevented stale owners, cancelled invocations, exhausted retries, final-step continuations, and repeated no-progress verification from extending execution incorrectly.
- Added deterministic final-response fallback so exhausted executions do not leave empty assistant turns.
- Kept filesystem permission failures, invalid arguments, missing edit matches, rejected permissions, and browser locator timeouts from creating false unknown-work records when no mutation occurred.

## Providers and Models

- Updated OpenCode Zen request identity and anonymous free-tier compatibility, including helper-call session/request IDs and provider-isolated SDK caching.
- Kept real permitted coding tools available for Zen greeting turns that reject a `model_control`-only request.
- Retained current-model retry before fallback and hardened provider-native response replay across provider changes.

## TUI and SDK

- Preserved the visible message and line while streaming content, tool results, taskflow events, or terminal resizing changes transcript height; returning to the bottom resumes follow-tail.
- Added user-visible checkpoint transcript parts and execution checkpoint events.
- Regenerated the JavaScript SDK for checkpoint parts, execution events, waiting-input state, and new reconciliation states.

## Companion Beta

- No Flutter Companion source changed; only the version advanced to `3.4.4+30404`.
- Companion remains beta. Android, iOS, background execution, and OEM integrations are not universally stable.

## Validation

- Root monorepo typecheck passed.
- Root monorepo tests passed: 1,766 tests passed, 10 opt-in tests skipped, 0 failed.
- Bundled `atomcli-guide` discovery and its three focused tests passed.
- Live provider checks and physical-device behavior remain opt-in and environment-dependent.

Version `3.4.4` is released only by pushing the exact `v3.4.4` tag.
