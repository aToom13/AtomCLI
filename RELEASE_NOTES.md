# AtomCLI v3.4.3-debug

AtomCLI 3.4.3-debug is a prerelease focused on review-loop correctness, task QA policy consistency, model-switch approval, and installer reliability. Companion remains a beta product under active development; Android, iOS, background execution, and OEM integrations are not universally stable.

## Review and Agent Reliability

- Reused a fresh reviewer PASS for the same unchanged revision at final completion instead of spawning another reviewer chain.
- Added the structured-output contract at the shared subagent spawn boundary so root and task reviewers receive the schema they are required to return.
- Persisted each root and task QA reviewer slot across retries and applied the configured `reviewer_count` and `max_attempts` values to task QA.
- Passed verified QA findings back to worker retries while retrying reviewer infrastructure failures without repeating completed worker side effects.
- Scoped restored patch evidence to the current non-synthetic user turn and cleared root and descendant review state after successful completion.
- Propagated cancellation to workflow workers and QA reviewers, bounded infrastructure failures, and corrected running-agent elapsed time.
- Invalidated review results when reviewed source changes during review.

## Model Control and Companion Beta

- Routed ask-mode model and thinking changes through the normal question flow with one-time, execution-wide, and keep-current choices.
- Recorded inline question answers as durable route decisions and suppressed duplicate pending-proposal prompts in the TUI and Companion bridge.
- Clarified Companion listener port behavior when the TUI uses in-process RPC or an explicit control server owns port 4096.
- No Flutter Companion application source changed relative to v3.4.3. The release workflow reuses the existing signed Companion APK when all APK inputs other than documentation and the version line are unchanged; otherwise it performs the normal signed build and certificate checks.

## Installer and Distribution

- Selected musl release binaries on Alpine and installed the required `libstdc++` and `libgcc` runtime packages when missing.
- Preserved existing configuration when optional Kilocode support is enabled and aligned the PowerShell default model with the Unix installer.
- Removed partial model-cache files after failed downloads and made install progress reach 100 percent only after final verification.
- Added interactive download progress and expanded platform smoke coverage for bundled skills, musl version output, and help output.
- Replaced platform-specific asset-copy commands in the build with Bun filesystem operations.

## Validation

- AtomBase typecheck passed.
- The focused review and agent suite passed 138 tests with no failures.
- The fixture-backed AtomBase suite passed 1,630 tests with 10 opt-in tests skipped and no failures.
- Bundled guide discovery and its three focused tests passed.
- Live provider checks and physical-device behavior remain opt-in and environment-dependent.

Version `3.4.3-debug` is prerelease metadata; the exact release tag is `v3.4.3-debug`. Companion remains beta.
