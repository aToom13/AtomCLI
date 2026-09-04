# Developing and contributing to AtomCLI

This reference is a contributor rulebook, not authorization to edit, commit, push, publish, or release. In an AtomCLI checkout, read the repository's current `AGENTS.md` first and follow any more recent instructions there.

## Repository map

| Location          | Purpose                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `AtomBase/`       | Main `atomcli` CLI, server, TUI, integrations, and tests         |
| `libs/sdk/js/`    | JavaScript SDK and generated v2 client                           |
| `libs/companion/` | TypeScript companion bridge, pairing auth, and discovery package |
| `companion/`      | Flutter Android/iOS companion application                        |
| `.atomcli/`       | Tracked bundled skills/agents plus ignored local runtime state   |
| `.claude/`        | Tracked compatibility assets plus ignored local runtime state    |
| `docs/`           | User and contributor documentation                               |

The monorepo root is not the primary package. Run package-specific commands in the relevant package directory; root `bun turbo` commands coordinate the workspace.

## Non-negotiable environment rules

- Use Bun only. Do not use npm or Yarn.
- Use the Bun version pinned in the repository's package manager field and lockfile.
- Do not enable TypeScript strict mode; `strict: false` is intentional in both TypeScript configurations.
- From `AtomBase/`, run source with the browser condition:

```sh
bun run --conditions=browser ./src/index.ts
```

The `--conditions=browser` flag is required for TUI and SolidJS resolution. Omitting it can produce silent import failures.

## Safe start for every change

1. Read the root `AGENTS.md` and any nearer instructions.
2. Inspect `git status --short` before editing; preserve user changes and unrelated work.
3. Locate the owning package and existing tests.
4. Use `rg`/`rg --files` to follow established patterns before introducing a new abstraction.
5. Make the smallest coherent change and add a regression test that observes behavior.
6. Format, typecheck, run focused tests, then run the appropriate full suite.
7. Re-check the diff and repository hygiene before handing off.

Do not infer permission to commit, push, tag, publish, or create a release from permission to implement a code change.

## Package and test commands

From the monorepo root:

```sh
bun install --frozen-lockfile
bun turbo typecheck
bun turbo test
```

From `AtomBase/`:

```sh
bun run dev
bun run typecheck
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json bun test
```

Focused test file:

```sh
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json bun test test/file/ignore.test.ts
```

Focused test name:

```sh
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json \
  bun test test/file/ignore.test.ts -t "match nested and non-nested"
```

Provider tests are opt-in:

```sh
bun run test:providers
```

Live provider audits require their explicit environment flags and real credentials. Default tests must use fixtures and must never call live provider APIs.

## Test isolation rules

- Tests use `bun:test` and live under `AtomBase/test/`, mirroring source paths.
- Any test file that imports `src/` must import `test/preload.ts` before the source import. `xdg-basedir` reads environment variables at module import time; the wrong order corrupts test isolation.
- Provider-touching tests require:

```sh
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json
```

- Do not “fix” default tests by adding real credentials or network calls.
- For listeners, companion sockets, and concurrent services, add tests that verify resource cleanup and explicit-versus-automatic port semantics.

## Formatting and TypeScript style

Prettier configuration is inherited from the root package:

- no semicolons;
- double quotes;
- `printWidth: 120`;
- no ESLint or Biome workflow unless the repository later adds one.

Format AtomBase sources with:

```sh
bunx prettier --write "src/**/*.{ts,tsx}"
```

Prefer path aliases over deep relative imports:

- `@/*` maps to `AtomBase/src/*`.
- `@tui/*` maps to the TUI source directory.

Follow the repository's observed import grouping: external packages and Node built-ins, relative siblings, then alias imports. Avoid `../../` chains across directory boundaries.

Types are Zod-first:

```ts
export namespace Example {
  export const Info = z.object({ name: z.string() })
  export type Info = z.infer<typeof Info>
}
```

Use named namespaces for modules, object-literal types where practical, camelCase values/functions, PascalCase types/namespaces/classes, and SCREAMING_SNAKE_CASE module guard constants.

## Runtime import constraint

Files built with `--conditions=browser` must not top-level import the `ai` SDK at runtime. Use type-only imports for types and dynamic imports for runtime access:

```ts
import type { SomeType } from "ai"

const { runtimeExport } = await import("ai")
```

A top-level runtime import can cause Bun ESM resolution failures that appear silent.

## State, logging, and errors

- Use `Instance.state()` for project-scoped cached initialization. Avoid unbounded mutable module-level state.
- Log with `Log.create({ service: "name" })` or `Log.Default`; do not add `console.log` to service code.
- Throw `new Error("message")` and let it propagate unless a boundary has a defined error translation.
- Put byte, item, retry, workflow, or time bounds in named constants at module scope.
- Preserve backward compatibility in `Config.Info`. New config fields must be optional and should have safe defaults; do not rename or remove existing fields.

## Tool implementations

Tools live under `AtomBase/src/integrations/tool/` and register through `Tool.define()`.

The execute result contract is:

```ts
{
  title: string
  output: string
  metadata: Record<string, unknown>
}
```

Do not change the `Tool.Info` return shape without updating every implementation. The wrapper already validates Zod input and truncates output at 2,000 lines or 50 KB. Set `metadata.truncated` manually only when the tool performs its own internal truncation.

The edit tool's fuzzy matching and failure behavior are deliberate. Preserve its fallback chain and never turn a failed match into a silent no-op.

## Agents and orchestration

- Native agents are defined in the state factory in `AtomBase/src/integrations/agent/agent.ts`.
- User agent Markdown files extend or override native agents; they do not replace the native registry wholesale.
- The orchestration session-map key format is `parentSessionId:agentType:taskId`. Changing it breaks workflow cleanup.
- The workflows map is bounded to 100 entries and has one-hour TTL cleanup. Do not remove those bounds.
- Orchestrated subagents must always be denied `todowrite`, `todoread`, and `task` permissions.

Treat permission changes as security-sensitive and cover them with focused tests.

## TUI development

- The TUI uses SolidJS through `@opentui/solid`.
- Components live under `AtomBase/src/interfaces/cli/cmd/tui/`.
- Use the `@tui/*` alias for TUI imports.
- Do not import TUI modules into contexts that are not built with `--conditions=browser`.
- Preserve responsive behavior for short/narrow terminals and add layout tests for boundary sizes.

Run the TUI from `AtomBase/` with `bun run dev` or the explicit browser-condition command.

## Server and SDK contract

Any server API route change under `AtomBase/src/server/` requires JavaScript SDK regeneration:

```sh
cd AtomBase
bun run dev generate > ../libs/sdk/js/openapi.json
cd ../libs/sdk/js
bun run build
```

Never manually edit `libs/sdk/js/src/v2/gen/`; it is generated output. After regeneration, confirm the generated client is stable and review the OpenAPI diff.

Before finishing a server API change, CI expects generated sources to be clean after regeneration:

```sh
git diff --exit-code -- libs/sdk/js/src/v2/gen
```

Listener implementation changes that do not alter routes or the OpenAPI contract do not require SDK regeneration, but still require server-focused tests.

Server security invariants:

- Default control-plane port is 4096 with available-port fallback.
- Non-loopback control-plane binds require authentication.
- CORS is restricted to allowed localhost, Tauri, AtomCLI, and configured origins.
- Keep `globalThis.AI_SDK_LOG_WARNINGS = false` in `server.ts` so the `ai` package does not corrupt stdout protocols.

## Companion package and app

Companion work may span two packages:

- `libs/companion/`: TypeScript bridge, discovery, authentication, replay, and pairing.
- `companion/`: Flutter mobile UI, background service, preferences, notifications, and WebSocket client.

The Zod schemas in `libs/companion/src/protocol.ts` are the Companion wire-contract source of truth. After changing them, run `bun run protocol:generate` and `bun run protocol:check` from `libs/companion/`; do not hand-edit the generated Dart handshake file or JSON Schema.

For bridge/server changes, run the relevant Bun tests in AtomBase and `libs/companion`. For Flutter changes:

```sh
cd companion
flutter pub get
flutter analyze
flutter test
flutter build apk --debug
```

Before device testing:

```sh
adb devices
flutter devices
flutter run -d <device-id>
```

Exercise QR pairing, LAN/Tailscale fallback, reconnect, permission decisions, background notifications, uploads/downloads, previews, session/model restoration, and device revocation in proportion to the changed area.

Keep multiple-process behavior explicit: automatic companion listeners may select different ports; an explicitly configured companion port must fail on collision instead of silently moving a stored endpoint.

## Build behavior

From `AtomBase/`:

```sh
bun run build
```

The build script deletes `AtomBase/dist/` before every build. Never store source, release notes, or irreplaceable artifacts there.

Tracked `.atomcli/` and `.claude/` assets are copied into every binary distribution. Before adding a bundled asset:

- ensure it is intentional, portable, and free of credentials;
- include only instruction assets required at runtime;
- keep package manifests, locks, dependencies, inbox files, logs, plans, runs, and session state ignored;
- never force-add ignored runtime content.

## Documentation and bundled guide maintenance

User-visible behavior changes include documentation work in their definition of done. Keep these layers synchronized:

| Topic                  | Canonical document                                       | Bundled reference            |
| ---------------------- | -------------------------------------------------------- | ---------------------------- |
| Overview and first run | `README.md`                                              | `getting-started-and-tui.md` |
| Configuration          | schema-owning docs                                       | `configuration.md`           |
| Providers and models   | `docs/PROVIDERS.md`                                      | `providers-and-models.md`    |
| Extensions and MCP     | `docs/SKILLS-GUIDE.md` / `docs/MCP-GUIDE.md`             | `extensions.md`              |
| Server and Companion   | `companion/README.md` and server docs                    | `server-and-companion.md`    |
| Contributor workflow   | `AGENTS.md`, `AtomBase/AGENTS.md`, `docs/DEVELOPMENT.md` | this file                    |

Keep the root `SKILL.md` a concise router and put detail in the relevant reference. Do not duplicate unstable provider catalogs, version numbers, or dynamically assigned ports. Validate examples against current CLI help and config against `Config.Info`.

After changing `atomcli-guide`:

```sh
cd AtomBase
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json bun test test/skill/atomcli-guide.test.ts
bun run --conditions=browser ./src/index.ts skill list
bun run --conditions=browser ./src/index.ts skill show atomcli-guide
```

Do not update release notes or version metadata unless release preparation was explicitly requested.

## Git and release hygiene

Do not commit credentials, configuration generated for one machine, dependencies, logs, test sandboxes, transcripts, generated binaries, or release staging directories.

Before a release, inspect:

```sh
git status --short
git status --short --ignored
git ls-files -ci --exclude-standard
```

The last command must produce no output: tracked files must not also be ignored.

Releases are triggered only by `v*` Git tags. Do not push commits or tags, publish packages, or create a release unless the user explicitly authorizes that exact action. When authorized:

- run the documented validation commands;
- ensure `RELEASE_NOTES.md` matches the package version and contains no emoji;
- push only the exact intended version tag;
- never substitute `git push --tags`;
- do not manually push `AtomBase/dist/` or `release_assets/`.

The tag workflow also analyzes and tests the Flutter Companion, then attaches a signed `atomcli-companion-android.apk` to the checksum-covered release assets. Published APKs require the persistent repository secrets `ATOMCLI_ANDROID_KEYSTORE_BASE64`, `ATOMCLI_ANDROID_KEYSTORE_PASSWORD`, `ATOMCLI_ANDROID_KEY_ALIAS`, and `ATOMCLI_ANDROID_KEY_PASSWORD`; the workflow must fail rather than publish a debug-signed APK when they are absent. Local debug-key release builds are for device testing only. Never commit an Android keystore or its passwords.

## Definition of done

For an ordinary AtomBase change:

1. `bun run typecheck` passes from `AtomBase/`.
2. Focused regression tests pass with the models fixture when provider code may load.
3. The full AtomBase suite passes, or root `bun turbo test` passes for cross-package changes.
4. Formatting and `git diff --check` pass.
5. Generated SDK state is correct if the server API changed.
6. `git status --short` contains only intended files.
7. Canonical docs and the matching bundled guide reference reflect user-visible behavior.
8. The handoff reports what changed, what was validated, and any unresolved failure without claiming success prematurely.
