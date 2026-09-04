# AGENTS.md

Guidance for agentic coding agents working in this monorepo. `AtomBase/` is the main package (the `atomcli` CLI + server + TUI); `libs/` holds workspace packages (SDK, companion); `companion/` is the Flutter mobile app.

## Must-follow constraints

- **Bun only** — no npm or yarn anywhere. Package manager is pinned to `bun@1.3.14`.
- **Monorepo root is not the main package.** All primary development happens in `AtomBase/`. Root `bun turbo` delegates to packages; run package-specific commands from within each package dir.
- Run the app with `bun run --conditions=browser ./src/index.ts` (from `AtomBase/`). The `--conditions=browser` flag is required for TUI and SolidJS imports; missing it causes silent import failures.
- **SDK codegen is required after any server API change.** After modifying routes in `AtomBase/src/server/`, regenerate the SDK:
  ```sh
  cd AtomBase
  bun run dev generate > ../libs/sdk/js/openapi.json
  cd ../libs/sdk/js
  bun run build
  ```
  Do not manually edit files in `libs/sdk/js/src/v2/gen/` — they are auto-generated.
- **Releases are triggered by `v*` git tags only.** CI builds and publishes on tag push. No release helper is tracked; maintainer-specific helpers must remain ignored. Do not manually push to `AtomBase/dist/` or `release_assets/`.
- **`AtomBase/dist/` is wiped on every build.** `build.ts` runs `rm -rf dist` unconditionally. Never store anything in `dist/`.
- **Tracked release assets under `.atomcli/` and `.claude/` are bundled into every binary release.** Local configuration, credentials, package manifests/locks, dependencies, plans, runs, and session state in those directories must remain ignored and must never be force-added.
- **Companion remains beta.** Keep the beta notice visible in the root README, `companion/README.md`, and release notes until the maintainer explicitly promotes it to stable. Do not describe Android, iOS, background execution, or OEM integrations as universally stable.
- **Update documentation with behavior.** User-visible changes must update the relevant canonical guide and, when the topic is covered there, the matching `.atomcli/skills/atomcli-guide/references/` file in the same change. Keep the root skill entrypoint concise and route detail to references.
- `strict: false` in both `tsconfig.json` files is intentional. Do not enable strict mode.

## Git and release hygiene

- Never commit credentials, local configuration, generated binaries, logs, session transcripts, test sandboxes, or release staging directories.
- Android signing keystores, password files, exported private material, and plaintext/base64 secret values must remain outside the repository. The release workflow may reference GitHub secret names, but it must never print their values and must refuse a debug-signed release APK.
- Before a release, inspect `git status --short`, `git status --short --ignored`, and `git ls-files -ci --exclude-standard`. The last command must produce no output; tracked files must not also be ignored.
- Scan all tracked and untracked commit candidates for private-key headers, provider tokens, credential-bearing URLs, and assigned secrets before staging. Test fixtures must use unmistakably fake values.
- Do not use `git add -f` to bypass repository ignore rules for `.atomcli/` or `.claude/` runtime state.
- Do not push commits or tags, create a release, or publish packages unless the user explicitly authorizes that exact action.
- When release authorization is explicit, run the documented validation commands and push only the exact version tag. Do not replace its exact-tag push with `git push --tags`. `RELEASE_NOTES.md` must match the package version and contain no emoji.

## Build / lint / test commands

```sh
# From repo root (all packages):
bun install --frozen-lockfile   # CI uses this too
bun turbo typecheck             # typecheck all packages (tsgo)
bun turbo test                  # test all packages

# From AtomBase/:
bun run dev                     # run CLI locally (--conditions=browser)
bun run build                   # cross-platform binary build (wipes dist/)
bun run typecheck               # tsgo --noEmit (not plain tsc)
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json bun test   # full suite

# Single test file:
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json bun test test/file/ignore.test.ts

# Single test by name inside a file:
... bun test test/file/ignore.test.ts -t "match nested and non-nested"

# Provider tests (opt-in via env flags):
bun run test:providers            # fixture-backed compatibility tests
ATOMCLI_PROVIDER_LIVE_TEST=1 ...  # live provider audit (needs real keys)

# Formatting (Prettier only — there is no ESLint/Biome config in this repo):
bunx prettier --write "src/**/*.{ts,tsx}"    # from AtomBase/, same as bun run format
```

CI (`.github/workflows/ci.yml`) runs: `bun turbo typecheck`, `bun turbo test` (with `ATOMCLI_TEST_HOME` set), verifies `libs/sdk/js/src/v2/gen` is unchanged (`git diff --exit-code`), and ShellChecks the installer.

## Code style guidelines

- **Formatting**: Prettier, `semi: false` (no semicolons), `printWidth: 120`, double quotes. Config lives in root `package.json`; there is no separate linter.
- **Imports**: Use path aliases everywhere — `@/*` → `AtomBase/src/*`, `@tui/*` → `AtomBase/src/interfaces/cli/cmd/tui/*`. No relative `../../` chains across directory boundaries. Order seen in codebase: external packages first (`zod`, node builtins like `path`/`fs/promises`), then relative siblings, then `@/*` imports.
- **The `ai` SDK must not be top-level imported** in files built with `--conditions=browser`. Use `import type` for types; use `await import(...)` for runtime. Violating this causes Bun ESM resolution failures silently.
- **Types**: Zod-first. Define schemas as `export const X = z.object({...})` then `export type X = z.infer<typeof X>`. Types use object-literal style (`type Logger = { ... }`), not `interface` where avoidable. `strict` is off, but do not write loosely-typed code just because you can.
- **Namespace pattern**: All modules export a named namespace (e.g., `Tool`, `Session`, `Config`, `Provider`, `Agent`). No loose top-level exports.
- **Naming**: PascalCase namespaces/types/classes, camelCase functions/variables, SCREAMING_SNAKE_CASE module constants (e.g., `MAX_EDIT_OPERATIONS`). Test files mirror source paths under `test/` with a `.test.ts` suffix.
- **Error handling**: Throw `new Error("message")` directly (dominant pattern, ~300 sites); let it propagate rather than swallowing errors. Log with `Log.create({ service: "name" })` (or `Log.Default`) — never `console.log`. Guard rails use named constants at module top (e.g., byte limits).
- **DI/singleton**: `Instance.state()` is the per-project cached-state pattern. Use it for any module needing project-scoped initialization. No unbounded module-level mutable state.
- **Tools**: Register via `Tool.define()` in `AtomBase/src/integrations/tool/`. The wrapper validates Zod schemas and truncates output at 2000 lines / 50 KB automatically. `execute()` returns `{ title, output, metadata }`; only set `metadata.truncated` yourself if your tool truncates internally.
- **Agents**: Native agents live in the `state` factory of `AtomBase/src/integrations/agent/agent.ts`. User-defined agents come from `.atomcli/agent/*.md` with YAML frontmatter — they extend/override native agents, never replace them.
- **TUI**: SolidJS on `@opentui/solid` (`jsxImportSource` in tsconfig). Components live under `AtomBase/src/interfaces/cli/cmd/tui/`, imported via the `@tui/*` alias. Never import TUI code outside `--conditions=browser` contexts.

Canonical module shape:

```ts
import path from "path" // 1. node builtins
import z from "zod" // 2. external packages
import { Tool } from "./tool" // 3. relative siblings
import { File } from "@/services/file" // 4. @/* aliases

const MAX_ITEMS = 100 // SCREAMING_SNAKE_CASE guard constants at top

export namespace Example {
  export const Info = z.object({ name: z.string() })
  export type Info = z.infer<typeof Info>
}
```

## Testing conventions

- Tests use `bun:test` (`import { test, expect } from "bun:test"`) and live in `AtomBase/test/`, mirroring source paths (`src/services/file/ignore.ts` → `test/file/ignore.test.ts`).
- Every test file that touches `src/` must import `test/preload.ts` before any `src/` import (see gotchas below).
- Provider-touching tests require the models fixture env var; never hit real APIs in the default suite.

## Validation before finishing

1. From `AtomBase/`: `bun run typecheck`, then the focused single test file for your change.
2. Before declaring done: full suite (`MODELS_DEV_API_JSON=... bun test`) or root `bun turbo test` for cross-package changes.
3. If you touched `src/server/` routes: regenerate the SDK and confirm `git diff --exit-code -- libs/sdk/js/src/v2/gen` is clean.
4. If you changed the bundled AtomCLI guide: run `MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json bun test test/skill/atomcli-guide.test.ts` and verify `bun run --conditions=browser ./src/index.ts skill list` discovers `atomcli-guide`.
5. For Companion release changes: from `companion/`, run `flutter analyze`, `flutter test`, and `flutter build apk --release`; verify the publish candidate with `apksigner` and reject certificates containing `CN=Android Debug`.

## Repo-specific conventions

- **Config precedence** (highest first): `ATOMCLI_CONFIG_CONTENT` env → project `atomcli.jsonc/json` or `mcp.json` → `ATOMCLI_CONFIG` file → global config → remote well-known.
- **Model specifier format**: `"providerID/modelID"` string (e.g., `"atomcli/minimax-m2.5-free"`). Split on first `/`.
- **Server default port**: 4096. Falls back to any available port if 4096 is taken.
- **Companion listener port**: automatic selection prefers 4096, then falls back to an OS-assigned port so concurrent AtomCLI processes can coexist. An explicit `--companion-port` or `server.companionPort` must fail on collision rather than silently moving.
- **CORS**: Only `localhost:*`, `127.0.0.1:*`, `*.atomcli.ai` (https), configured whitelist, and explicit Tauri origins are allowed.

## Important locations

| Location                                         | Purpose                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| `AtomBase/src/integrations/tool/`                | All tool implementations                                         |
| `AtomBase/src/integrations/agent/agent.ts`       | Native agent definitions + permission defaults                   |
| `AtomBase/src/integrations/provider/provider.ts` | Provider registry, custom loaders, model resolution              |
| `AtomBase/src/core/config/config.ts`             | Config schema, loading order, agent/plugin/command file loading  |
| `AtomBase/src/core/eval/`                        | Agent eval harness, benchmark runner, verifier stash logic       |
| `AtomBase/evals/`                                | Benchmark suite definition and per-case fixtures                 |
| `AtomBase/src/server/server.ts`                  | Hono server, route registration, CORS                            |
| `AtomBase/script/build.ts`                       | Cross-platform binary build (clears dist/, copies `.atomcli/`)   |
| `AtomBase/test/preload.ts`                       | Test environment setup (XDG dirs, provider key clearing)         |
| `AtomBase/test/tool/fixtures/models-api.json`    | Required fixture for any provider-touching test run              |
| `libs/sdk/js/src/v2/gen/`                        | Auto-generated SDK — do not edit manually                        |
| `libs/companion/`                                | @atomcli/companion — pairing auth, mobile bridge, discovery      |
| `companion/`                                     | Flutter mobile companion app (Android/iOS)                       |
| `.atomcli/` (repo root)                          | Tracked bundled skills/agents; local runtime state stays ignored |
| `.atomcli/skills/atomcli-guide/`                 | Bundled user and contributor guide with focused references       |

## Change safety rules

- **`Tool.Info` return shape** (`{ title, output, metadata }`) must not change without updating all tool implementations.
- **`AGENT_SESSION_MAP` key format** in `orchestrate.ts` is `"parentSessionId:agentType:taskId"`. Changing format breaks `purgeSessionMapForWorkflow`.
- **Config schema** (`Config.Info` in `config.ts`) must stay backward-compatible. New fields must be optional with defaults. Never rename or remove existing fields.
- **`WORKFLOWS` map** in `orchestrate.ts` is bounded to `MAX_WORKFLOWS = 100` with 1-hour TTL cleanup. Do not remove this bound.
- **Subagent permissions** in `OrchestrateTool` must always deny `todowrite`, `todoread`, and `task` for sub-agents.

## Known gotchas

- `bun test` **without** `MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json` fails on provider tests — fixture path is not auto-discovered.
- Test `preload.ts` **must run before any `src/` import** because `xdg-basedir` reads env vars at import time. Imports before preload corrupt test isolation.
- The `antigravity` provider's model list is **deliberately emptied** (`database["antigravity"].models = {}`). Do not restore it.
- `privatemode-ai` is a **runtime mock alias** for `atomcli`/`opencode`. Do not remove it; it prevents test failures on missing provider.
- **Edit tool uses a 9-step fallback chain** for fuzzy matching (`oldString`). If exact match fails, it tries line-trim, block-anchor, whitespace-normalize, indentation-flexible, escape-normalize, trimmed-boundary, context-aware, and multi-occurrence. Match failures throw — they do not silently no-op.
- **`globalThis.AI_SDK_LOG_WARNINGS = false`** is set in `server.ts` to suppress `ai` package warnings to stdout. Do not remove it.
- Running `bun install` from **inside `.atomcli/`** directories is part of normal runtime (plugin loading). These `package.json` files and their `node_modules` are intentionally gitignored inside `.atomcli/`.

## Documentation map

- `README.md`: product overview and shortest supported workflows.
- `docs/README.md`: maintained documentation index.
- `docs/DEVELOPMENT.md`: contributor workflow, validation, architecture, and release hygiene.
- `docs/SKILLS-GUIDE.md`: skill discovery, loading, authoring, bundling, and verification.
- `companion/README.md`: Android pairing, endpoints, security, transfers, previews, and device validation.
- `.atomcli/skills/atomcli-guide/`: runtime help shipped with releases. Keep its references aligned with the canonical documents above without duplicating release-specific facts.

Validate example commands against the current CLI help and configuration examples against `Config.Info`. Do not add release notes for an unreleased behavior change unless the user asks to prepare a release.
