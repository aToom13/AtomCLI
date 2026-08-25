# AtomCLI Android companion

The Android companion is a remote control and transfer surface for AtomCLI. It shows live sessions and sub-agents, handles permission and question requests, lets a paired device continue a session, transfers files in both directions, and controls live project previews. Every visible action is backed by a server request and an acknowledgement; unsupported placeholder controls are not shown.

iOS is not part of the current delivery target.

## Connect

Start AtomCLI with companion access enabled:

```sh
atomcli serve --companion
```

Scan the printed QR code in the Android app. The payload may contain both kinds of endpoint:

- a Tailscale address for encrypted access across networks;
- a private LAN address for devices on the same trusted network.

The app tries the supplied endpoints in order and reconnects automatically. A foreground Android service keeps the signed command link active while the UI is closed and restores it after device restart. Android shows a low-priority persistent connection notification while this service is active. Plain `ws://` and `http://` traffic is enabled for local-network development, so it should only be used on a network you trust. Prefer Tailscale when the phone is not on the same trusted LAN.

The visible app and background service hand the socket to each other. Only one owns the connection at a time: the app owns it while visible, and the foreground service owns it after the app is hidden. While hidden, permission requests and questions still produce high-priority notifications. Running task lists remain visible as an ongoing notification, and new files or live previews produce transfer notifications.

Pairing creates an Ed25519 device identity in Android secure storage. Mutating requests are signed, sequenced, and matched to server acknowledgements. Use **Link > Forget this machine** to revoke the device on the server and remove its local credentials.

## Files and live previews

Ask AtomCLI on the PC to send a file or image to the phone. The agent uses the `companion_send` tool after the normal file-read permission decision. The item appears under **Deck > Machine inbox**, grouped as **From `<machine-name>`**, with an image preview when applicable plus download/open and Android share controls. Transfer links use short-lived unguessable tokens and expire after 24 hours.

Examples to enter in a PC session:

```text
Send docs/architecture.png to my phone.
Send the latest build report to the Companion and title it Android build report.
```

In a mobile session, use the attachment button beside the message field and choose **Photo or image** or **Any file**. The upload is stored under the selected project’s `.atomcli/inbox/mobile/` runtime directory and is attached to that session. The agent receives explicit context that the file and request came from the Android Companion. Image attachments are rendered in the conversation when their transfer record is available.

Ask the PC agent to start a mobile preview. The `companion_preview` tool runs the development server as a managed process, binds it to `0.0.0.0`, discovers Tailscale and LAN addresses, and places a website card in Deck. The card can open the site in the phone browser, show captured stdout/stderr, or stop the process.

```text
Start the web app with bun run dev on port 3000 and send me a live Companion preview.
Preview the docs site from apps/docs on port 4321 so I can open it on my phone.
```

The selected port must be reachable through the machine firewall. A preview URL has no AtomCLI authentication layer; it should expose only a development server and should be used over Tailscale or a trusted LAN.

## Validate

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
- PC-to-phone image preview, download/open and Android share actions;
- phone-to-session image and file upload from the attachment button;
- live preview open, log refresh and stop controls over Tailscale and LAN;
- device revocation from Link.

Android may stop every background component after the user explicitly force-stops the app in system settings. Opening AtomCLI Companion again restarts the command-link service.
