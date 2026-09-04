# Server, attach mode, ACP, and companion

## Headless server

Start the HTTP server:

```sh
atomcli serve
atomcli serve --help
```

Shared network options include:

- `--port <number>`: control-plane port. Automatic mode prefers 4096 and falls back to an available port.
- `--hostname <host>`: bind host; default is loopback.
- `--auth <token>`: bearer token for the control-plane API.
- `--cors <origin>`: additional allowed origins; may be repeated.
- `--mdns`: enable discovery and default to a reachable bind when appropriate.
- `--companion`: enable pairing and print companion connection information.
- `--companion-port <number>`: explicitly fix the companion listener port.

A non-loopback control-plane bind is refused without `--auth`:

```sh
ATOMCLI_SERVER_TOKEN="strong-random-token" \
  atomcli serve --hostname 0.0.0.0 --auth "$ATOMCLI_SERVER_TOKEN"
```

Avoid putting bearer tokens directly in shell history. An environment variable or `{file:PATH}` config is preferable.

Default CORS policy permits localhost, `127.0.0.1`, explicit Tauri origins, HTTPS `*.atomcli.ai`, and configured origins. Add only origins that need access.

## Attach and remote control-plane use

Attach the TUI to a running server:

```sh
atomcli attach http://127.0.0.1:4096
```

Run a prompt through a server:

```sh
atomcli run --attach http://127.0.0.1:4096 --auth "$ATOMCLI_SERVER_TOKEN" "Inspect the project"
```

Use the URL printed by the server because automatic port fallback can choose another port.

## ACP

Start Agent Client Protocol mode for an ACP-compatible editor or client:

```sh
atomcli acp --help
```

ACP communicates over its protocol streams and also uses the AtomCLI server internally. Configure its working directory and network/companion options according to the client integration.

## Companion pairing

The Android companion uses a separate scoped listener bound for LAN or Tailscale reachability. Pair from the intended project directory:

Companion is a beta product under active development. Its UI, protocol capabilities, background behavior, and Android integration may change between releases. The PC-side AtomCLI session and project workspace remain authoritative.

```sh
atomcli --companion
```

Or with the headless server:

```sh
atomcli serve --companion
```

AtomCLI prints a QR code containing reachable WebSocket endpoints and a short-lived pairing token. The phone and computer must share a reachable LAN or Tailscale path, and the selected port must pass the host firewall.

The companion supports secure challenge authentication after pairing. Paired device credentials are loaded globally so future AtomCLI launches can accept reconnection without issuing a new pairing token.

The challenge also negotiates the Companion protocol version and named capabilities. AtomCLI reports separate machine, project directory, process, bridge, device, and connection identities so reconnects and concurrent processes are not conflated. Existing protocol-v2 clients remain compatible; current clients negotiate v3.

The Android connection engine reports endpoint discovery, transport connection, authentication, synchronization, connected, retry, suspended, and incompatible-protocol phases separately. Use the Link screen's phase and endpoint details when a generic network error would otherwise be ambiguous.

Android permission notifications offer only one-time allow and deny; permanent and autonomous authority remains inside the app. Direct Reply is available only for one ordinary text question, never for multi-part, select, or password questions. The background callback sends the same signed request as the app and waits for the PC acknowledgement before displaying success. Offline, stale, conflicted, and timed-out actions remain unconfirmed and are not placed in the Outbox. Live snapshots and resolution events cancel obsolete OS notifications. OEM battery policy, notification permission, and force-stop can still prevent Android from delivering the callback, so tapping a system action is not itself proof that AtomCLI received it.

Link stores a background-power mode. Balanced (default) keeps the background socket only for active work or unresolved decisions and stops after authoritative idle state; Real time keeps one socket for the selected machine while idle; App only disconnects outside the foreground and therefore cannot promise background alerts. Background heartbeat cadence is slower, failed retries back off with jitter up to five minutes, Flutter applies streaming parts in 50 ms UI batches, the PC skips per-token mobile serialization with zero connected clients, and Preview pauses WebView execution/timers in the background. Companion does not start its foreground service from Android boot or package-replaced receivers because Android 12+ can reject that launch; open the app once after a reboot or update so lifecycle handoff can resume. These reduce work but do not prove battery consumption on a specific OEM or override force-stop, Doze, VPN loss, thermal limits, or restricted-battery policy.

Companion privacy defaults to generic notification content and Android screen-capture protection. Link can explicitly show notification details, retain protected generic text, or request that Android hide notifications on a secure lock screen; these are presentation controls and do not replace transport encryption. Android `FLAG_SECURE` blocks ordinary screenshots, recordings and recent-app snapshots while the activity is visible, but not another camera, a compromised OS, overlays, accessibility-service abuse, or an OEM that ignores visibility hints. PC-side control outcomes are appended to the owner-only, rotating `~/.atomcli/companion-audit.jsonl` with action type, result, stable device ID and normalized error code only. Never put prompts, answers, command parameters, secrets or paths in this audit or routine Companion diagnostics.

For real-device smoke validation, build the release APK and run `companion/tool/verify-android-device.sh`; set `ATOMCLI_ANDROID_SERIAL` when more than one device is connected. Exit code 3 and every `CHECK` line are inconclusive rather than successful. In particular, separately observe pairing/authenticated snapshot recovery, lock-screen redaction, screenshot blocking, Doze and network handoff, action acknowledgements, checksum verification, Android Live Update eligibility and actual Samsung Now Bar placement.

For an active user-started task, Companion posts one native Android Live Update with the current task/step name, a stable elapsed-time chronometer and a compact progress value when one is available. A parseable `x/y` state uses Android's real `ProgressStyle`; unknown totals remain text rather than inventing a percentage. Expanding the card shows the title, verified step progress and a standard **View tasks** notification action. Tapping the card or action deep-links to Deck and focuses its workflow when an ID is available; protected notification mode deliberately replaces the task name with generic text.

Android 16 can promote the public notification to the status chip; Samsung One UI 8 consumes the same mechanism for Now Bar cards. Companion declares `POST_PROMOTED_NOTIFICATIONS` and sets the public `EXTRA_REQUEST_PROMOTED_ONGOING` request for every active primary task. On API 36+, it does not mix legacy Samsung `android.ongoingActivityNoti.*` extras into the public notification: physical One UI 8.5 testing showed that the legacy style marker can declassify or cancel a valid `ProgressStyle`. Only Samsung devices below API 36 receive OEM extras for Now Bar text, icon, tap target and AOD identity, plus the ongoing-activity manifest metadata. These fields are undocumented hints, never run on other brands, and use neither reflection nor hidden classes. Older systems fall back to a silent standard ongoing notification. Identical task state is deduplicated and the card is canceled when work ends, so this path adds no polling or second socket. AtomCLI guarantees the eligible promotion request; Android retains control of its final SystemUI placement when notification settings, user demotion or OEM policy intervene. Treat Android's promoted flag and actual lock-screen/SystemUI placement as separate observations. The idle connection foreground-service notification remains low-priority and is never requested as a Live Update.

Companion navigation links use `atomcli://open` with bounded `profile`, `machine`, `tab`, `session`, `request`, and `workflow` fields. They can select a saved profile and open Control, Chat, Requests, or Settings, but cannot carry commands, credentials, endpoints, filesystem paths, messages, or permission decisions. Files is a separate primary destination so transfer search and previews do not compete with mission state on Control; connection diagnostics and persisted appearance/power/privacy choices stay under Settings. Profile switching uses the normal socket handoff and clears old machine state first. Unknown profiles and machine/profile mismatches fail closed; stale card identifiers open the destination without claiming that the item still exists.

Use **Link > Run connection doctor** to classify saved LAN/Tailscale routes and test URI parsing, DNS and TCP reachability. It is an on-demand bounded probe: TCP success does not prove authentication, and VPN/DNS/background restrictions may cause a temporary false failure.

Companion live events include a bridge epoch and sequence cursor. Reconnect replay is used only when the retained event range covers that cursor; epoch mismatch, an ahead cursor, or a buffer gap triggers an authoritative snapshot resync. Clients suppress duplicate or out-of-order events while resynchronizing.

The Android safe outbox accepts only plain-text messages for an existing session. A queued response is not proof of delivery. Each entry is machine-scoped, bridge-epoch-aware, idempotent, capped by a 15-minute lifetime, and retried only after authenticated reconnection. Permission/question decisions, pause/stop actions, autonomous-mode changes, session creation, and temporary attachments require a live connection and are rejected offline. The server reuses the stored result for a repeated device/idempotency-key pair instead of executing the prompt twice.

Chat shows the user's message optimistically and keeps the draft field usable while the live acknowledgement is in flight. Sending, Accepted, Queued, and Failed describe transport state only: Accepted confirms command receipt, not a model reply or completed work. A failed optimistic send removes the temporary bubble and restores the draft. Provider execution failures remain visible as session-scoped assistant cards after history reload, show the exact provider/model route, and offer explicit model selection. Authentication, credit and rate-limit status codes receive localized guidance; unknown provider text remains bounded and verbatim. Response bodies, headers, credentials and URL query values are removed before mobile delivery. Provider failures are not retried automatically because a partially executed prompt may already have side effects. Idle history entries can be permanently deleted after confirmation; an active session must first stop or complete.

The Android app stores the latest task snapshot, session index, machine metadata, and safe outbox in app-private SQLite. Payloads are AES-GCM encrypted with a separate platform-secure-storage key. It does not cache authentication material, pending authority decisions, or short-lived transfer/preview URLs. Restored state is labelled as offline cache and must not be interpreted as current PC reachability or task liveness; the next authoritative snapshot replaces it. Forgetting a machine clears its cached state and queued messages.

Preview 2.0 runs the requested development server on loopback and publishes a separate LAN/Tailscale gateway. A signed `preview_access` action returns a two-minute bootstrap token which is exchanged for an HttpOnly, SameSite-strict cookie and removed from the URL. The in-app WebView allows only the exact gateway origin, denies file/content access, mixed content and permission prompts, and offers 390/768/1280 px viewport presets. Its visible-viewport screenshot can be uploaded and attached to the originating session. The gateway currently proxies HTTP only and rejects WebSocket upgrades, so HMR can appear disconnected even when the page and static assets load; reload manually. Use Tailscale or a trusted LAN because the gateway's HTTP access control is not transport encryption.

Preview health is a bounded, non-persistent observation surface for console warnings/errors, uncaught runtime and promise failures, subresource load failures, and HTTP error statuses. Repeats are merged, native/JavaScript reports of the same fault are correlated, and at most 24 unique entries are retained. URL credentials/query/fragment fields plus common token assignments are redacted before display, while UI refreshes are batched for noisy pages. Reload clears the observation window. An empty panel means no supported hook observed an error; it does not certify visual correctness, application behavior, HMR, accessibility, or complete request success.

Mobile session input supports camera/gallery images, freehand/arrow/box markup, arbitrary files, and device-only dictation into an editable draft. Images are bounded to 2048 px at 85% quality and dictation stops after 45 seconds; neither path sends automatically. Android share-sheet text/URLs and files require explicit target-session confirmation, accept at most 10 files/256 MiB, disclose skipped or unreadable inputs, and use app-private temporary copies with stale cleanup. OEM speech availability and recognition accuracy vary, so a populated draft is not proof that technical terms were transcribed correctly. Background clipboard reads and direct screen capture are not supported.

Companion follows the system locale with English and Turkish catalogs. Navigation, sessions, transfers, permission/question controls, pairing, Preview, notifications, Live Update/Now Bar text, Android native share warnings, and iOS privacy descriptions use the same locale; unsupported locales fall back to English. Dates, times and byte counts are locale-aware. Raw provider/server failures without stable error codes remain untranslated rather than being guessed from free-form text.

Core Companion surfaces expose localized screen-reader semantics for connection state, headings, mission progress, steps, and agent actions. Status text is visible independently of color, small muted labels meet AA contrast on card surfaces, and primary controls use 48 dp minimum targets. Deck is covered by a 2× system-text widget test and live logs are deliberately not marked as live regions. These automated checks do not prove real TalkBack/VoiceOver focus order, Switch Access behavior, keyboard traversal, OEM display zoom, or spoken output; verify those on supported physical devices.

Companion adapts by current window width: compact windows use bottom navigation, windows at 720 logical pixels use a navigation rail, and Sessions becomes a searchable history/conversation split at 840 px. A reported vertical separating fold or hinge reserves space between the panes, very wide Deck content is capped at 1120 px, and landscape Preview removes its secondary status strip. Synthetic resize/hinge tests cannot prove OEM fold geometry, split-screen insets, or state retention through every rotation; test those transitions on target hardware.

Transfer Inbox covers both directions and supports search, type filtering, project/session context, explicit record removal, and 24-hour expiry. Transfer-v2 peers use resumable 4 MiB chunks, authoritative upload offsets, HTTP Range downloads, immutable PC snapshots, and SHA-256 verification. Returning from Android's system picker first completes the background-service-to-app socket handoff; a ticket acknowledgement lost during that transition is retried once with its original idempotency key. Download partials and encrypted upload journals survive an app restart; a paused upload resumes on the next authenticated foreground connection, and a lost server ticket is safely replaced. Completion means the final size and checksum matched, not that Android has an app capable of opening the MIME type. Removing a record revokes the managed transfer data but does not delete the user's original PC file.

## Multiple AtomCLI processes

When no companion port is explicitly configured:

1. The first process prefers companion port 4096.
2. A later process detects the collision and selects another available port.
3. Each process owns a separate companion listener.
4. A phone is connected only to the listener whose endpoint it opened; starting a listener does not make it appear as an authenticated connected phone.

To pair or reach a second process, use the endpoint/QR information for that process. A previously saved `:4096` endpoint normally reaches the process that owns 4096, not the dynamically assigned second process.

The Android Link screen stores and groups paired profiles as machine → project → process. Each profile has its own endpoints, bridge cursor, encrypted cache, and Outbox scope, while only one foreground command socket is active. Switching closes the old socket and clears machine-scoped live state before restoring the selected profile. The authenticated identity check rejects a saved endpoint if it now exposes another machine or a different known project. Rescan that process to deliberately update the profile.

Forgetting a link removes only that project/process cache and queue. Companion device authorization is machine-wide, so server-side revocation occurs only when the last saved link for that physical machine is removed; other machines remain paired.

## Mission Control

Control groups workflow steps and child agents into Mission Control cards. The list is scoped to the selected session and its recursively known child sessions, so two AtomCLI processes or sessions sharing one directory do not mix task cards. Requests remains a global surface for the selected process profile so pending authority is not hidden. Orchestrator events include a stable workflow ID, and child agents include their parent step ID, preventing concurrent workflows in one session from cross-updating by array index. Pending permission/question requests from a parent or known child session make that mission `WAIT`; unrelated project requests do not.

The selected chat session also presents child-agent tool, command, and transcript events in one bounded assistant-style activity card. Its internal list follows the newest event without growing the whole conversation indefinitely. The bridge retains a limited recent event window per child agent and includes it in reconnect snapshots; parent-session and directory scoping prevent unrelated processes from appearing in the card.

Companion prompts use a fast, risk-proportionate execution profile. Low-risk prototypes and routine edits run directly or with at most one implementation sub-agent and one focused verification, without manually spawning reviewer/checker agents. An 18-step ceiling forces a text handoff instead of an unbounded tool loop, and core-memory recall uses local BM25 order without spending a separate provider call on LLM reranking. Security, authentication/authorization, credentials, migrations, schemas, release/deployment paths, failed verification and repeated retries still require independent review; an explicit `review.policy: "always"` is not weakened. PC-originated prompts retain the standard execution profile. A new mobile message starts a fresh turn and does not implicitly resume an older unfinished plan. These bounds remove redundant validation layers but cannot guarantee latency from the selected provider, network, build, or external tool.

Mission states are `LIVE`, `WAIT`, `PAUSED`, `DONE`, and `FAIL`. Pause is a signed live-only request that cancels the current turn but preserves the session for a later continuation. Stop marks an explicit termination and cancels the turn after mobile confirmation. Neither is an operating-system process freezer or rollback mechanism: already completed tool side effects remain, external commands may require time to observe cancellation, and an event-delivery delay can temporarily leave the card stale until the next event or authoritative snapshot. These authority-changing controls are never stored in the offline Outbox.

If `--companion-port` or `server.companionPort` explicitly fixes a port, AtomCLI does not silently move it. A collision produces an error so an advertised/stored endpoint cannot unexpectedly refer to another port.

Diagnosis:

```sh
atomcli --print-logs --companion
```

Check:

- whether a fixed companion port exists in project or global config;
- whether the firewall allows the actual selected port;
- whether LAN/Tailscale endpoints are detected;
- whether the phone retained an endpoint for a different AtomCLI process;
- whether another process owns the requested fixed port.

## mDNS and reachability

mDNS publication is useful only on a non-loopback hostname. Loopback binds intentionally skip mDNS publication because other devices cannot reach them. Binding `0.0.0.0` does not itself make a service internet-accessible, but it exposes it on available interfaces; pair it with authentication and firewall rules appropriate to the network.
