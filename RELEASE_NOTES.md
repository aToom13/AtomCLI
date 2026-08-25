# AtomCLI v3.4.2-beta

This is an early developer preview of the redesigned Android Companion. It is intended for development devices and trusted local networks. Interfaces and wire behavior may still change before a stable release.

## Android Companion Developer Preview

- Rebuilt the mobile experience around Deck, Sessions, Inbox, and Link instead of decorative placeholder screens.
- Added live session history, streamed assistant text, reasoning state, tool state, sub-agent activity, task progress, and session status.
- Added searchable recent sessions, working-directory selection from a folder tree, and continuation of existing AtomCLI conversations from Android.
- Added model selection with recent and favorite ordering, provider grouping, free-text filtering, capability filters, reasoning variants, and persistence of the last used model, variant, agent, and directory.
- Added expandable tool details so command input, output, errors, and completion state can be inspected from the phone.
- Added session abort controls and explicit Android-origin context in prompts sent from the phone.

## Remote Approvals

- Added a mobile inbox for permission requests and structured questions.
- Added Allow once, Always allow, and confirmed Full autonomous decisions from Android.
- Kept Always allow aligned with the reviewed permission pattern rather than granting an unrelated broader rule.
- Added mutex handling so a request accepted on one client cannot be resolved again by another client or the TUI.
- Added high-priority Android notifications while the app is hidden and a pending approval or question is waiting.

## File Transfer and Previews

- Added PC-to-phone sharing through the `companion_send` tool, including image previews, download, open, and Android share actions.
- Added phone-to-session uploads for images and arbitrary files, with multi-file staging, removable attachments, upload progress, and model-compatibility fallback messaging.
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

- Android is the current companion delivery target; iOS remains out of scope for this preview.
- Synced AtomCLI workspace versions and the Flutter application version through one release-version command.
- The `-beta` suffix is prerelease metadata, so `v3.4.2-beta` publishes as a GitHub prerelease.

## Validation

- AtomBase and workspace typechecks passed.
- Deterministic Bun test suites and focused companion security, transfer, bridge, permission, and Flutter widget tests passed.
- Flutter analysis and tests passed.
- Release metadata was checked against the exact `v3.4.2-beta` tag contract.
