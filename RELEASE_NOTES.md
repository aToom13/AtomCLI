# AtomCLI v3.4.2

AtomCLI 3.4.2 improves installation, updates, browser portability, agent execution, and the redesigned Android Companion. Companion remains a beta product under active development: its mobile UI, protocol capabilities, background behavior, and platform integrations may change in later releases. Local-network access is intended for trusted networks; Tailscale remains the recommended remote path.

## Installation and Updates

- Reworked the Bash and PowerShell installers with dependency discovery, automatic repair where supported, progress bars, activity indicators, checksum verification, and clearer failure recovery.
- Added the same dependency and browser-health repair path to `atomcli update`; retained `atomcli upgrade` as a compatible alias and added explicit-version updates.
- Added `atomcli setup --check` for a non-mutating health probe and `atomcli setup --yes` for unattended dependency repair.
- Kept release archives, generated binaries, local configuration, runtime state, and signing material outside tracked source.

## Browser Reliability

- Fixed Playwright discovery in compiled `atomcli` binaries so an installation is rechecked after repair instead of remaining stuck behind a failed import cache.
- Added release-matched Playwright installation and a real Chromium launch probe rather than treating file presence as a successful browser setup.
- Added dependency handling and diagnostics for Arch/CachyOS, Debian/Ubuntu, and Fedora/RHEL families, plus the portable Windows and macOS installation path.
- Improved headless fallback and Chromium channel selection for systems without an active X11 or Wayland display.

## Long-running Task Continuity

- Added session-scoped taskflow checkpoints after every five tool calls or five minutes, evaluated on the next active model turn without waking idle sessions.
- Included a bounded snapshot of recorded step states and an explicit stale-status reminder when work continues without a taskflow update.
- Kept reminders advisory: AtomCLI never marks a task complete merely because tools ran or time elapsed.
- Reset reminder cadence when a plan starts or clears and kept reviewer, checker, explorer, and planner sessions outside the progress-injection path.

## Android Companion Beta

- Rebuilt the mobile experience around Deck, Sessions, Inbox, and Link instead of decorative placeholder screens.
- Reorganized the interface into clearer control, chat, request, file, and settings surfaces; added selectable accent themes and adaptive layouts for larger screens.
- Added live session history, streamed assistant text, reasoning state, tool state, sub-agent activity, task progress, and session status.
- Kept sub-agent activity inside a bounded, internally scrolling message card instead of allowing long-running work to grow the entire conversation indefinitely.
- Added searchable recent sessions, working-directory selection from a folder tree, and continuation of existing AtomCLI conversations from Android.
- Scoped task, chat, cache, transfer, and connection state by machine, project, process, and session so concurrent AtomCLI instances do not merge their work.
- Added model selection with recent and favorite ordering, provider grouping, free-text filtering, capability filters, reasoning variants, and persistence of the last used model, variant, agent, and directory.
- Added expandable tool details so command input, output, errors, and completion state can be inspected from the phone.
- Added optimistic message delivery states, failure recovery, conversation deletion, session abort controls, and explicit Android-origin context in prompts sent from the phone.
- Added a risk-proportionate Companion execution profile to reduce unnecessary sub-agent fan-out and verification latency for routine mobile requests while retaining stronger review for sensitive work.
- Fixed Android 16 Live Update eligibility by declaring promoted-notification access and posting every active primary task through the public promoted-ongoing contract used by Samsung Now Bar. Promoted status, task title, progress, and lock-screen placement were validated on a Samsung SM-S938B running Android 16 and One UI 8.5.

## Remote Approvals

- Added a mobile inbox for permission requests and structured questions.
- Added Allow once, Always allow, and confirmed Full autonomous decisions from Android.
- Kept Always allow aligned with the reviewed permission pattern rather than granting an unrelated broader rule.
- Added mutex handling so a request accepted on one client cannot be resolved again by another client or the TUI.
- Added high-priority Android notifications while the app is hidden and a pending approval or question is waiting.

## File Transfer and Previews

- Added PC-to-phone sharing through the `companion_send` tool, including image previews, download, open, and Android share actions.
- Added phone-to-session uploads for images and arbitrary files, with multi-file staging, removable attachments, upload progress, and model-compatibility fallback messaging.
- Replaced fragile single-request uploads with resumable chunks, authoritative offsets, idempotent ticket recovery, app-private staging, and whole-file checksum validation to prevent picker handoff timeouts from losing the transfer.
- Added `companion_preview` for managed development servers, discoverable LAN and Tailscale URLs, captured logs, browser launch, and remote stop controls.
- Added machine-grouped received items in Deck, persistent empty states, bounded transfer history, and 24-hour artifact retention.
- Added transfer notifications for shared artifacts and preview activity where Android permits them.

## Connectivity and Reliability

- Added QR pairing with an Ed25519 device identity, signed and sequenced mutations, replay rejection, and secure local credential storage.
- Added automatic endpoint selection that prefers private LAN addresses and falls back to Tailscale routes.
- Added foreground/background WebSocket ownership handoff backed by an Android foreground service.
- Added restart-safe bridge epochs so event replay works after AtomCLI exits and starts again.
- Fixed companion listener fallback behavior when the requested port is unavailable.
- Reduced false upload failures by using direct HTTP transfer semantics with bounded connection timeouts.

## Security Boundaries

- Stored uploaded files inside the selected project workspace and validated resolved paths before writing.
- Bounded upload sizes, artifact counts, preview counts, log tails, ticket lifetimes, and artifact retention.
- Used unguessable artifact tokens and authenticated WebSocket mutations for companion actions.
- Required normal read, bash, external-directory, and preview permissions before AtomCLI accesses or executes user content.
- Documented that plain local-network traffic is intended only for a trusted development LAN and that Tailscale is preferred across untrusted networks.

## Platform Scope

- Android is the current companion delivery target; iOS remains outside this release's supported scope.
- Added a signed Android Companion APK to the GitHub release assets and checksum manifest.
- Companion is distributed as beta software even though AtomCLI 3.4.2 uses stable CLI version metadata.
- Synced AtomCLI workspace versions and the Flutter application version through one release-version command.
- Version `3.4.2` is stable release metadata; the exact release tag is `v3.4.2`.

## Validation

- AtomBase and workspace typechecks passed.
- Deterministic Bun test suites and focused companion security, transfer, bridge, permission, and Flutter widget tests passed.
- Flutter analysis and tests passed.
- Release metadata was checked against the exact `v3.4.2` tag contract.
