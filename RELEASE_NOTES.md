# AtomCLI v3.4.5

This release strengthens session recovery, makes completion depend on execution evidence, limits redundant disk growth, and improves provider routing and Companion integration.

**Companion remains beta.** Android, iOS, background execution and OEM integrations are not universally stable. The desktop session and project files remain authoritative.

## Reliable execution and recovery

- Persistent execution records, ownership leases and checkpoints support recovery after interruptions. Stale processes cannot finish work owned by a newer process.
- Completion checks reference actual tool calls and current source fingerprints. Changed source, interrupted checks and ambiguous command chains cannot appear as independently verified success.
- Retry and fallback paths respect execution budgets and cancellation. Cancelling a model request before its first token no longer terminates the server through an unhandled SDK promise rejection.
- TUI prompt submission, terminal resizing and session resume have regression coverage. Failed submissions retain their drafts for retry.

## Bounded storage growth

- Snapshot capture defaults to a global 1 GiB object budget, a 2 MiB per-file limit, and a 64 MiB / 10,000-file tree ceiling. Dependency and runtime directories are excluded; project Git ignore rules apply.
- Capture stops at its budget while existing rollback data is retained. Excluded files are not available for snapshot rollback. Existing oversized repositories require explicit cleanup.
- Duplicate model-request and tool-replay payloads are disabled by default. Opt-in diagnostics expire after seven days; normal conversations, tool results and durable execution accounting remain.
- Replaced blobs retire when no current pointer shares them. Scheduled maintenance compacts verified legacy duplicates and collects eligible orphan data, with protection for referenced records and unfinished work.
- Live storage records have a 2 GiB admission ceiling: growth fails visibly instead of deleting conversation history. Backups, legacy data and installed binaries are outside that accounting.
- Inspect cleanup with `atomcli debug storage --all-projects`; add `--apply` to execute. Restart older AtomCLI processes before maintenance.

## Models, MCP and tools

- AtomCLI Free and Auto have independent settings and qualified model allowlists. Free stays within explicitly free AtomCLI candidates; fallback preserves routing restrictions.
- Provider requests preserve protocol-specific endpoints, credentials, streaming tool-call identities and capability verification. Temporary gateway rejection is distinguished from invalid authentication.
- MCP OAuth retains issuer and configured client identity. Permitted tool discovery remains available across execution scopes; selected schemas are bounded and revalidated before dispatch.
- Project autonomous mode stays project-scoped. Explicit permission denials remain effective, including external file access.
- File discovery and missing-path diagnostics provide clearer recovery guidance. Skill reference loading stays within explicit context budgets.
- Browser flows release held input after failure or cancellation. Accessibility and network inspection evidence cannot substitute for requested visual or interaction checks.

## Outcome-based benchmark grading

- Suite v5 uses independent final verification for acceptance. Recovered tool errors and retries reduce efficiency scores without failing correct completed work.
- Failed verification, incomplete execution, missing required checks and hard timeouts remain failures. Historical strict grading remains available for custom suites.
- Private verifiers are isolated from native and shell tools, including child sessions and symlink aliases. Live runs require a sanitized disposable workspace and working OS isolation.
- No fresh complete live-model benchmark pass is claimed by these source and integration tests.

## Companion beta

- Android devices without camera hardware retain manual pairing instead of crashing during scanner initialization. Empty-chat actions wrap and scroll on small screens when the keyboard is open.
- Every release rebuilds the Android APK and checks its embedded version against the tag. Earlier release APKs are no longer reused with stale version metadata; production signing remains mandatory.
- QR pairing to another machine clears the prior machine's live conversation state while retaining scoped persisted history.
- A repeatable Android suite drives the real app against two independent AtomCLI processes: signed pairing, chat, parallel file writes, cancellation, question/permission decisions, bidirectional transfers, reconnect, offline delivery, lifecycle transitions and project switching.
- Only the test model HTTP responses are scripted; server execution, tools, storage, authentication and mobile services are real.
- The test APK uses a separate application ID. CI preserves test evidence without publishing fixture credentials. Emulator coverage does not establish physical QR-camera, LAN/Tailscale, OEM notification, Doze or iOS behavior.

## Validation

- Bun 1.3.14: 2,369 AtomBase tests passed, 14 skipped, no failures; monorepo typechecks passed in all five packages.
- Browser suite with real Chromium: 41 tests passed in both desktop and headless runs. Companion bridge: 20 tests passed; protocol and SDK generation verified.
- Flutter 3.47.2: analysis clean, 79 unit/widget tests passed, release APK built.
- Android 16 / API 36 emulators: all 10 integration scenarios passed with camera hardware and without it; the small-screen and open-keyboard regression also passed. The current release-mode APK passed install, launch, manifest, secure-window flag and crash checks on the camera-free emulator.
- Dependency audit, version alignment, installer checks, ShellCheck and workflow syntax checks passed locally. Linux CI explicitly probes namespace isolation before running the tests. Skipped and physical-device checks are not counted as successful coverage.
