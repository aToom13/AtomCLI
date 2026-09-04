# AtomCLI Android companion

The Android companion is a remote control and transfer surface for AtomCLI. It shows live sessions and sub-agents, handles permission and question requests, lets a paired device continue a session, transfers files in both directions, and controls live project previews. Every visible action is backed by a server request and an acknowledgement; unsupported placeholder controls are not shown.

**Beta status:** Companion remains under active development. It is suitable for testing and everyday development assistance, but its mobile UI, protocol capabilities, background behavior, and platform integration may change between releases. The PC-side AtomCLI session and project files remain authoritative; do not use the phone as the only record of important work.

The interface follows the device locale and currently ships complete Flutter catalogs for English and Turkish. The same locale also drives local notifications, Android Live Update/Now Bar text, native Android share-import warnings, locale-aware dates, times and file sizes, and iOS privacy descriptions. Unsupported locales fall back to English. Server/provider text that arrives without a stable error code remains verbatim so translation never changes its technical meaning.

Core controls expose TalkBack/VoiceOver semantics for connection state, section headings, mission progress, steps and nested agents. Statuses retain visible text instead of relying on color alone, small muted text meets AA contrast against the darkest card surface, and interactive controls use a 48 dp minimum target. The Deck header and command controls are constrained for large system text; automated widget tests exercise 2× text scaling and semantic labels. Streaming logs are ordinary navigable text, not live regions, so each appended line does not interrupt the screen reader. A passing semantic-label test is not proof of a good physical-device focus order: validate TalkBack swipe navigation, Switch Access, external keyboard focus, font scaling and display zoom on the actual supported devices.

Window width drives the shell rather than the device model: compact windows use bottom navigation, while windows at least 720 logical pixels wide use a persistent navigation rail. The primary destinations are Control, Chat, Requests, Files, and Settings; transfers no longer compete with mission state on Control, while connection diagnostics, power/privacy controls, and the persisted Azure/Violet/Coral accent choice live under Settings. Chat becomes a searchable history/conversation split view at 840 px. A vertical separating fold or hinge reserves its projected physical gap between panes, and very wide Control content is capped at a readable 1120 px. Preview drops its secondary status strip and uses a compact toolbar in landscape. Resizing is covered by widget tests, including a synthetic hinge; this does not prove every OEM-reported fold bound, freeform-window size, keyboard inset or rotation transition, so those remain physical-device checks.

iOS is not part of the current delivery target.

## Connect

Start AtomCLI with companion access enabled:

```sh
atomcli --companion
atomcli serve --companion
```

Use `atomcli --companion` for the interactive TUI or `atomcli serve --companion` for the headless server. Scan the printed QR code in the Android app. The payload may contain both kinds of endpoint:

- a Tailscale address for encrypted access across networks;
- a private LAN address for devices on the same trusted network.

The app tries the supplied endpoints in order and reconnects automatically. Its connection state machine distinguishes endpoint discovery, transport connection, device authentication, snapshot synchronization, connected operation, retry delay, foreground/background handoff, and incompatible protocols. These phases provide the UI with an exact status instead of treating every incomplete connection as the same generic failure. A foreground Android service keeps the signed command link active while the UI is closed. It deliberately does not launch from boot or package-replaced receivers: Android 12+ can reject that foreground-service start, and the rejected launch can crash the receiver process. Open Companion once after a phone restart or app update; normal foreground/background lifecycle handoff then restores the service when policy requires it. Android shows a low-priority persistent connection notification while this service is active. Plain `ws://` and `http://` traffic is enabled for local-network development, so it should only be used on a network you trust. Prefer Tailscale when the phone is not on the same trusted LAN.

Link exposes three persisted background-power modes. **Balanced** (default) keeps the service/socket only while a mission, sub-agent or decision is active and stops again after authoritative state becomes idle. **Real time** keeps one socket for the active machine even while idle; it is the mode for immediate new alerts and costs more battery. **App only** closes the socket when the UI leaves the foreground and cannot deliver background alerts. Background heartbeats are slower than foreground heartbeats, failed connection retries use jittered exponential backoff capped at five minutes, and only the selected machine owns a socket. Streaming message parts are applied to Flutter state in 50 ms batches, while the PC skips per-token Companion serialization when no mobile client is connected. Preview explicitly pauses WebView execution/timers outside the foreground. None of these policies can override Android force-stop, Doze, VPN loss or OEM process killing; a visible notification is not proof that its socket is alive.

Link also stores two independent privacy controls. **Notification content** defaults to **Protect content**, which preserves notification actions but replaces questions, permission targets, task names, transfer names and preview titles with generic text. **Show details** opts into that content; **Hide on lock screen** additionally requests Android's secret lock-screen visibility. **Block screen capture** defaults on and applies Android `FLAG_SECURE`, covering screenshots, screen recording and the recent-app snapshot while the activity is visible. OEM lock-screen policy can override notification presentation, and `FLAG_SECURE` cannot defend against another camera, a compromised OS, malicious overlays or accessibility-service abuse.

The PC writes a local, content-free Companion control audit to `~/.atomcli/companion-audit.jsonl`. Entries contain timestamp, action type, outcome, stable device ID and a normalized error code only; message text, command parameters, answers, file paths and payloads are excluded. The current journal rotates near 1 MiB to one previous file and uses owner-only permissions where the host filesystem supports them. Normal Companion diagnostics likewise record message length/count and error class rather than raw mobile input. Android application backup is disabled so an installation's signing identity and local command state are not silently restored onto another phone; a replacement phone must pair again. Audit persistence is best effort: a full or read-only disk must not turn a denied operation into an allowed one or take down the control channel.

The visible app and background service hand the socket to each other. Only one owns the connection at a time: the app owns it while visible, and the foreground service owns it after the app is hidden. While hidden, permission requests and questions still produce high-priority notifications. Running task lists remain visible as an ongoing notification, and new files or live previews produce transfer notifications.

Android permission notifications expose only **Allow once** and **Deny**. Permanent grants and autonomous mode stay inside the app so they cannot be enabled by an accidental lock-screen tap. A single ordinary text question can use Android Direct Reply; multi-part, selection, and password questions must be opened in Companion. Question notifications also provide **Decline**. Command patterns are reduced to a target count in the lock-screen body instead of exposing full shell commands.

Notification actions are signed and sent through whichever foreground/background socket currently owns the connection. The notification remains present until the PC returns an action acknowledgement. Only then is it replaced briefly with **AtomCLI confirmed**; an offline, expired, conflicted, malformed, or timed-out request becomes **Action not completed** and remains available in the app. Authority decisions are never persisted to the safe Outbox. Resolution events and live authoritative snapshots remove stale OS notifications, including decisions completed from the PC. Android can still delay or suppress a background callback because of OEM battery policy, force-stop, notification permission, or a killed foreground service; a button animation by itself is therefore never treated as server success.

One active, user-started AtomCLI task is also published through the native Android Live Update API. On Android 16+, the application manifest requests `POST_PROMOTED_NOTIFICATIONS` and every active primary task requests promoted treatment through the public `EXTRA_REQUEST_PROMOTED_ONGOING` contract, with the current task/step name as the title, a system chronometer, a real `ProgressStyle` when an `x/y` total exists, and a short status chip such as `3/6`; One UI 8 can surface the same standard Live Update in Samsung's Now Bar. Expanding the system card shows the task name, verified step progress and a **View tasks** action. Tapping either the card or that action opens Deck and focuses the matching workflow when an ID is available. Notification privacy still wins: the name is replaced with generic text unless **Show details** is selected.

On Android 16 and newer, Samsung receives only the public Live Update payload. The legacy `android.ongoingActivityNoti.*` extras are intentionally not mixed into that notification because tested One UI 8.5 builds can declassify or reject the otherwise valid public `ProgressStyle`. Samsung devices below API 36 receive those undocumented OEM hints as a compatibility path, together with the required ongoing-activity application metadata; they are never sent on other brands and use no reflection. Older devices receive a quiet standard ongoing notification instead. Repeated identical state is not reposted, child agents are summarized under the primary task, and the notification is removed when no task remains. AtomCLI guarantees creation of the correctly formed promotion request while a primary task is active. Android still reserves the final SystemUI placement: notification permission, the Live Updates app setting, user demotion/dismissal and OEM policy can move it back to an ordinary ongoing notification. A promoted flag proves Android accepted the notification; physical lock-screen/SystemUI observation proves its Now Bar placement. The persistent connection notification is deliberately not promoted.

Notification bodies and external launchers can route into the app through `atomcli://open`. The supported target fields are `profile`, `machine`, `tab`, `session`, `request`, and `workflow`. A target first selects the saved machine/project/process profile through the same safe socket handoff as the Link screen, then opens Deck, Sessions, Inbox, or Link and places the referenced card first with a visible border. Cold-start and `singleTop` warm-start intents use the same parser.

Deep links are navigation hints, not authorization tokens. Only the `atomcli://open` host, a fixed field allowlist, and bounded identifiers are accepted. Links cannot contain commands, permission resolutions, messages, paths, endpoints, or credentials, and they never execute an action. Unknown profiles and machine/profile mismatches fail closed on the Link tab. A session, request, or workflow may have disappeared before the app receives the link; in that case the destination still opens but no success claim is shown for a missing card.

Pairing creates an Ed25519 device identity in Android secure storage. Mutating requests are signed, sequenced, and matched to server acknowledgements. Use **Link > Forget this machine** to revoke the device on the server and remove its local credentials.

The authenticated handshake negotiates a numbered wire-protocol version and named capabilities. Machine, project directory, AtomCLI process, bridge instance, phone installation, and socket connection use separate identities; a reconnect therefore cannot make a restarted process look like the same live bridge. Protocol v2 remains accepted for existing installations, while current clients advertise v3 and consume the server's negotiated capability set.

Live events carry a bridge epoch and monotonically increasing sequence cursor. Reconnects send the last persisted cursor; AtomCLI replays it only when the epoch and retained buffer cover the requested range. A restarted bridge, cursor ahead of the server, or buffer gap returns `resync_required` and an authoritative snapshot with its own ID, generation time, epoch, and cursor. The app drops duplicate/out-of-order events and pauses event application until that snapshot arrives, preventing a superficially connected UI from retaining stale cards.

When a previously opened session temporarily loses its connection, the app may place a plain-text chat message in its safe outbox. A queued receipt means only that the phone accepted the message; it is not a delivery or execution acknowledgement. The entry is bound to the selected machine and the last known bridge epoch, carries an idempotency key, expires after 15 minutes, and is retried after authenticated reconnection. AtomCLI caches the corresponding command result by device and idempotency key, so a repeated request does not execute the same prompt twice. New-session creation, permission decisions, pause/stop controls, autonomous-mode changes, and messages containing temporary attachments are never queued. They fail visibly and require a live connection because replaying stale authority or ephemeral files would be unsafe.

Chat inserts a sent message into the visible transcript immediately instead of locking the text field until the server round trip finishes. Its compact delivery label distinguishes **Sending**, server **Accepted**, offline **Queued**, and **Failed** states. Accepted means AtomCLI received the chat command; it does not mean the selected provider produced a reply, a tool finished, or the requested work succeeded. On a failed live send the optimistic bubble is removed and the draft is restored so the user can retry without retyping. A provider failure becomes a persistent, session-scoped assistant card in both the live transcript and reloaded history. Stable HTTP classes such as authentication, credit and rate-limit failures receive localized guidance, while the exact provider/model route remains visible because identical model names can use different accounts or billing paths. Raw response bodies, headers, credentials and URL query values are not sent to the phone. Companion never retries a provider failure automatically because a partially executed prompt may already have caused side effects; the user can choose another model and explicitly resend. Idle history entries expose a confirmation-gated permanent delete action; running sessions cannot be deleted from Companion.

Prompts sent from Companion use a fast, risk-proportionate execution profile. A routine edit or low-risk prototype should be handled directly or with at most one implementation sub-agent, followed by one focused verification; it should not fan out into additional manual reviewer/checker agents. Companion turns have an 18-step ceiling and must return a text result when the ceiling is reached instead of continuing an open-ended tool loop. Core-memory recall keeps its local BM25 results but skips the optional LLM reranking call on this path. Authentication, authorization, security, credentials, migrations, schemas, release/deployment paths and failed or repeatedly retried work still retain independent review. An explicit `review.policy: "always"` remains authoritative, and prompts started from the PC keep the standard profile. Each new mobile message is treated as a fresh turn rather than an instruction to resume an older unfinished plan unless the message says so. This reduces redundant latency, but it does not make provider response time, network delay or the duration of a genuinely expensive build deterministic.

When the selected session spawns child agents, Chat groups their live tool, command, and transcript activity into one assistant-style work card. The card is scoped by parent session and machine directory, keeps only a bounded recent activity window, and scrolls internally to the latest event instead of continuously increasing the transcript height. Completion and failure remain visible in the card header, and reconnect snapshots restore the bounded activity history.

The app keeps its last task snapshot, session index, known-machine metadata, and safe outbox in an app-private SQLite database. Payload columns are AES-GCM encrypted with a key held separately in platform secure storage. Machine identifiers and storage timestamps remain database metadata; authentication keys, signatures, pairing tokens, permission requests, question requests, and temporary transfer/preview URLs are never placed in the offline cache. Cached screens are explicitly labelled as cached and do not imply that the PC is reachable or that a task is still running. A live authoritative snapshot replaces them after reconnection. Corrupt or unreadable cache records are discarded without blocking pairing or the live connection, and forgetting a machine removes its cached rows and queued messages.

Paired device records are global to the local AtomCLI installation. Once at least one device is paired, later AtomCLI launches can start a Companion listener for reconnection without printing a new QR code. Passing `--companion` explicitly starts a new pairing flow and prints current endpoint information.

## Machines, projects, processes, and ports

The Companion listener is separate for each AtomCLI process:

1. With no fixed Companion port, the first process prefers port 4096.
2. If 4096 is already occupied, another process selects an OS-assigned available port instead of exiting.
3. Pairing output and QR data use the actual bound port.
4. Each listener exposes only its own AtomCLI process and project/session context.

This means two terminals can run `atomcli` concurrently even when a paired device causes Companion support to start automatically. Scan each process that should remain available. The Link screen groups saved links as machine → project directory → AtomCLI process and keeps an independent endpoint list, bridge epoch, event cursor, cache, and Outbox scope for each profile. Rescanning the same machine/project/port refreshes that profile; a different port remains a distinct concurrent process.

Only one profile owns the foreground command socket at a time. Selecting another profile first closes the old socket, clears machine-scoped permissions, questions, sessions, models, agents, previews, and transfers from memory, then restores only the selected profile's safe offline cache and starts its connection. The handshake refuses an endpoint whose machine or known project identity does not match the selected profile, preventing a reused port from silently showing another process. A saved `:4096` endpoint still reaches whichever process currently owns 4096; scan the replacement process again if that ownership changed.

**Forget this AtomCLI link** removes only the selected project/process profile, its cache, and its queued messages. Device authorization is machine-wide, so the app does not revoke the PC while another saved process on that same machine still needs it. If no profiles remain, the phone identity and pairing material are removed and the app returns to the scanner.

Automatic selection is the default. A port explicitly configured with either of these mechanisms is treated as a stable contract:

```sh
atomcli --companion --companion-port 5096
atomcli serve --companion --companion-port 5096
```

```json
{
  "server": {
    "companionPort": 5096
  }
}
```

If that explicit port is occupied, AtomCLI fails instead of silently moving to a different endpoint. Remove the fixed value to restore automatic selection, or choose a different known port and update firewall rules accordingly.

For diagnosis, start the intended process with `atomcli --print-logs --companion` and verify the printed endpoint, configured `server.companionPort`, LAN/Tailscale reachability, and host firewall. Logs are stored under `~/.atomcli/logs/`.

The **Link > Run connection doctor** action checks each saved route on demand. It validates the WebSocket address, classifies LAN/Tailscale/MagicDNS, resolves DNS, attempts the TCP port with a bounded timeout, and reports refused, timed-out, unresolvable, and unreachable routes separately. Checks run sequentially and only when requested to avoid unnecessary radio and battery use. A successful TCP probe does not prove that the Companion authentication or protocol handshake will succeed; conversely Android VPN, Private DNS, temporary network switching, firewall rate limits, and background restrictions can produce a false failure.

## Mission Control

Control assembles chain steps, child-agent lifecycle events, and pending decisions into Mission Control cards. Cards are scoped to the selected chat session plus its recursively known child-agent sessions; another AtomCLI process or session cannot leak tasks into that view merely because it uses the same project directory. The global Requests count remains visible so an authority decision is not accidentally hidden. A workflow ID is carried with every orchestrator chain event, so concurrent workflows in the same parent session do not update one another by positional index. Child agents carry their parent step ID and appear beneath that step. A failed child remains `FAIL` in the authoritative snapshot instead of being mistaken for a completed or missing agent.

The card shows completed/total steps and uses compact states: `LIVE` is executing, `WAIT` is pending or needs a permission/question decision, `PAUSED` has had its current turn cancelled, `DONE` completed, and `FAIL` failed or was stopped. A permission from a child session is counted on its parent mission; unrelated requests are not attached merely because they came from the same project.

**Pause** and **Stop** are signed, live-only controls. Pause cancels the active turn without recording an explicit session termination, preserving the transcript so the user can open the session and continue it later. Stop records an explicit termination before cancelling the turn and is confirmation-gated in the app. Neither action can suspend an arbitrary operating-system process at an instruction boundary, undo side effects already completed by a tool, or guarantee that a non-cooperative external command stops instantly. A delayed event can briefly leave a card looking live after acknowledgement; the next chain event or authoritative snapshot corrects it. Decision buttons are shown only when the mission or one of its known child sessions has a pending permission or question.

## Files and live previews

Ask AtomCLI on the PC to send a file or image to the phone. The agent uses the `companion_send` tool after the normal file-read permission decision. The item appears under **Files**, grouped by source, with an image preview when applicable plus download/open and Android share controls. The file surface includes both PC downloads and phone uploads, can search file/session/machine labels, and filters images from other files. It also shows the active project, direction, session, expiry, partial-byte state, and checksum verification state.

Transfer v2 uses 4 MiB chunks and SHA-256 for every optional chunk plus the completed file. Downloads use HTTP byte ranges and a checksum-bound ETag; a partial is retained in app-private storage for 24 hours and resumes after a network change or app restart. Phone uploads use an authoritative server offset. Android's system picker briefly backgrounds Companion, so the app waits until the service isolate has fully released the command link before requesting an upload ticket. If that ticket acknowledgement is lost during the handoff, Companion reconnects once and repeats the request with the same device-scoped idempotency key; AtomCLI returns the cached ticket instead of creating a second upload. Before the first chunk, Companion copies the selected source into app-private storage and writes an AES-GCM-encrypted SQLite journal containing the target profile/session and resumable URL. Pausing or closing the app therefore retains the job, and the next authenticated foreground connection continues it. If AtomCLI restarted and forgot the ticket, the phone requests a replacement and starts that same verified source again. Protocol-v2 peers retain the former single-request upload fallback.

PC-to-phone shares are immutable 24-hour snapshots: editing the original after sharing cannot silently change a resumed download. Removing an inbox record revokes its link and deletes only AtomCLI-managed snapshots/partials; it never claims to delete the user's original PC file. A transfer is complete only after size and whole-file SHA-256 verification. MIME labels and the availability of a phone app capable of opening the result are still independent and can fail after a valid download.

Examples to enter in a PC session:

```text
Send docs/architecture.png to my phone.
Send the latest build report to the Companion and title it Android build report.
```

In a mobile session, use the attachment button beside the message field to take a camera photo, choose an image or arbitrary file, or mark an image with freehand strokes, arrows, and boxes. Camera/gallery input is reduced to at most 2048 px at 85% quality before editing to bound radio, memory, and battery cost. The upload is stored under the selected project’s `.atomcli/inbox/mobile/` runtime directory and staged for that session; it is not sent to the agent until **Send** is pressed. The agent receives explicit context that the file and request came from the Android Companion. Image attachments are rendered in the conversation when their transfer record is available.

The microphone button uses device-only dictation for at most 45 seconds and places partial/final recognition into the editable draft. It has no network-recognition fallback and never submits automatically, so unsupported OEM speech services fail visibly and technical terms or filenames must be checked before sending. Android's share sheet accepts text/URLs and up to 10 files with a 256 MiB import cap. Companion copies accepted content into app-private temporary storage, shows the exact target session/project and any skipped/unreadable-item warning, and requires **Add to draft** confirmation. Imported temporary files are removed after upload/discard or by a 24-hour stale cleanup. Clipboard background reads and direct screen capture are intentionally not implemented.

Ask the PC agent to start a mobile preview. The `companion_preview` tool runs the development server as a managed process bound to loopback, then exposes it through a dedicated AtomCLI preview gateway on the discovered Tailscale and LAN addresses. Deck can inspect the site in an origin-locked in-app WebView, show captured stdout/stderr, or stop the process. Phone, tablet and desktop viewport presets change the page viewport; the screenshot action uploads the visible viewport and attaches it to the preview's originating session as agent feedback.

The Preview health panel collects only WebView-observed console warnings/errors, uncaught JavaScript errors, unhandled promise rejections, subresource load failures, and HTTP failure statuses for the currently loaded page. It is bounded to 24 unique in-memory entries, merges repeats, and correlates native/JavaScript reports of the same runtime or resource failure so one fault is not presented twice. URL credentials/query/fragment data plus common token assignments are removed before display. Rendering refreshes are batched to limit the cost of noisy pages. Reloading starts a fresh observation window, and nothing from this panel is persisted or uploaded automatically. **No captured errors** means only that these hooks observed no failure; it is not proof that the UI, business behavior, HMR, accessibility, or every network request works correctly.

```text
Start the web app with bun run dev on port 3000 and send me a live Companion preview.
Preview the docs site from apps/docs on port 4321 so I can open it on my phone.
```

The gateway port must be reachable through the machine firewall. A signed live request mints a two-minute bootstrap URL; the gateway exchanges it for an HttpOnly, SameSite-strict session cookie and removes the token from the address. Preview URLs and credentials are not persisted in the offline cache. WebView navigation is limited to the exact gateway scheme, host and port; file/content URL access, mixed content and page permission requests are denied. This protects access control but does not encrypt ordinary LAN HTTP: prefer Tailscale or a trusted LAN and do not expose sensitive development data.

The current gateway proxies HTTP requests and same-origin assets, but deliberately rejects WebSocket upgrades. A Vite-style page can therefore render while HMR reports disconnected; use manual reload after changes. “Loaded” is not proof that every runtime request succeeded or that all three viewport presets are genuinely responsive, and a screenshot captures only the visible viewport rather than the full page. Stopping a preview tears down both its child process and gateway.

## Validate

The Zod contract in `libs/companion/src/protocol.ts` is authoritative. Regenerate the checked-in JSON Schema and Dart handshake models after changing it:

```sh
cd libs/companion
bun run protocol:generate
bun run protocol:check
```

Do not hand-edit `lib/generated/companion_protocol.g.dart`.

From this directory:

```sh
flutter pub get
flutter analyze
flutter test
flutter build apk --debug
```

The debug APK is written to `build/app/outputs/flutter-apk/app-debug.apk`. For a release APK, run `flutter build apk --release`; the result is written to `build/app/outputs/flutter-apk/app-release.apk`.

The Android toolchain may ask for its SDK and NDK licenses on a new workstation. Review and accept them interactively before the first build:

```sh
flutter doctor --android-licenses
```

## Test on a USB device

Enable developer options and USB debugging on the phone, connect it, and approve the computer fingerprint on the device. Then run:

```sh
adb devices
flutter devices
flutter run -d <device-id>
```

For the S25 Ultra test, verify:

- QR pairing plus Tailscale and LAN fallback;
- two simultaneous AtomCLI processes choosing distinct automatic Companion ports;
- saving and switching between two machines and two projects without state leaking between profiles;
- a reused endpoint being rejected when its machine or known project identity differs;
- explicit Companion port collision failing without moving the configured endpoint;
- reconnecting to the intended process rather than a stale endpoint owned by another process;
- the recent, favorite, AtomCLI and provider sections in the model picker;
- free/reasoning/favorite filters and supported thinking variants;
- creating a session after selecting a working directory from the folder tree;
- restoring the last model, thinking variant, agent and directory;
- expanding tool calls to inspect command input, output and error details;
- stopping a running session;
- Allow once, Always allow and Full autonomous permission decisions;
- question replies from Inbox;
- reconnect and decision notifications after closing the UI;
- one active Companion WebSocket when switching between foreground and background;
- ongoing task-list notifications while PC work is running;
- Android 16 Live Update status chip and Samsung One UI 8 Now Bar fallback behavior;
- PC-to-phone image preview, download/open and Android share actions;
- phone-to-session image and file upload from the attachment button;
- live preview open, log refresh and stop controls over Tailscale and LAN;
- device revocation from Link;
- TalkBack reading connection, mission progress, step status and agent actions in a useful order without repeatedly announcing appended logs;
- 2× font size/display zoom without clipped primary actions, plus at least 48 dp touch targets for composer controls;
- Switch Access and external keyboard traversal reaching every primary action with a visible focus indicator;
- compact-to-tablet live resize switching bottom navigation to the persistent rail without losing the selected tab;
- searchable session history and the active conversation remaining visible together in wide windows;
- portrait/landscape rotation, split-screen resizing and a fold/hinge gap without content under the occlusion.
- all three notification privacy modes on an unlocked phone and a secure lock screen, including generic content and action availability;
- Android screenshots, screen recording and the recent-app card while screen protection is enabled and disabled;
- Balanced, Real time and App only behavior with screen off, battery saver, Doze and restricted battery state;
- audit entries after allow/deny, question reply, pause/stop and revoke, confirming that no prompt, answer, command, path or secret appears;
- Wi-Fi/mobile-data handoff and LAN/Tailscale loss, distinguishing TCP reachability from authenticated snapshot recovery;
- task completion from a second client followed by cancellation of the stale phone notification;
- checksum failure, interrupted upload resume and an expired transfer token without treating 100% bytes as verified completion.

After building the release APK, the bounded device smoke script automates installation, cold launch, package/permission inspection and crash detection, then prints explicit `CHECK` lines for claims that still need human observation:

```sh
cd companion
./tool/verify-android-device.sh
# Multiple phones: ATOMCLI_ANDROID_SERIAL=<adb-serial> ./tool/verify-android-device.sh
```

Exit `0` means the automated checks passed, `1` means an observed failure, `2` means the tool/APK setup is invalid, and `3` means no authorized device was available. A `CHECK` line is deliberately inconclusive: device eligibility or a posted notification is not proof of Now Bar placement, and a running process is not proof of a live authenticated socket.

Android may stop every background component after the user explicitly force-stops the app in system settings. Opening AtomCLI Companion again restarts the command-link service.
