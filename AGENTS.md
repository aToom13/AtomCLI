# AGENTS.md

## Must-follow constraints

- **Bun only** — no npm or yarn anywhere. Package manager is pinned to `bun@1.3.6`.
- **Monorepo root is not the main package.** All primary development happens in `AtomBase/`. Root `bun turbo` delegates to packages; run package-specific commands from within each package dir.
- **SDK codegen is required after any server API change.** After modifying routes in `AtomBase/src/server/`, regenerate the SDK:
  ```sh
  cd AtomBase && bun run dev generate > ../libs/sdk/js/openapi.json
  cd libs/sdk/js && bun run build
  ```
  Do not manually edit files in `libs/sdk/js/src/v2/gen/` — they are auto-generated.
- **Releases are triggered by `v*` git tags only.** CI builds and publishes on tag push. Do not manually push to `AtomBase/dist/` or `release_assets/`.
- **`AtomBase/dist/` is wiped on every build.** `build.ts` runs `rm -rf dist` unconditionally. Never store anything in `dist/`.
- **The `.atomcli/` and `.claude/` directories at repo root are bundled into every binary release.** Changes there take effect in the next `bun run build` in `AtomBase/`.
- `strict: false` in both `tsconfig.json` files is intentional. Do not enable strict mode.

## Validation before finishing

From `AtomBase/`:
```sh
bun run typecheck                                          # uses tsgo
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json bun test
```

From root (all packages):
```sh
bun turbo typecheck
bun turbo test
```

## Repo-specific conventions

- **Path aliases**: `@/*` → `AtomBase/src/*`, `@tui/*` → `AtomBase/src/interfaces/cli/cmd/tui/*`. Use these everywhere; no relative `../../` chains.
- **Namespace pattern**: All modules export a named namespace (e.g., `Tool`, `Session`, `Config`, `Provider`, `Agent`). No loose top-level exports.
- **`ai` SDK must not be top-level imported** in files built with `--conditions=browser`. Use `import type` for types; use `await import(...)` for runtime. Violating this causes Bun ESM resolution failures silently.
- **Tools** are registered via `Tool.define()` in `AtomBase/src/integrations/tool/`. The wrapper automatically validates Zod schema, truncates output (2000 lines / 50 KB), and sets `metadata.truncated`. Only set `metadata.truncated` yourself if your tool handles truncation internally.
- **Agents** are defined in `AtomBase/src/integrations/agent/agent.ts` in the `state` factory (native, compiled-in). User-defined agents come from `.atomcli/agent/*.md` files with YAML frontmatter — those extend/override native agents, not replace them.
- **Config precedence** (highest first): `ATOMCLI_CONFIG_CONTENT` env → project `atomcli.jsonc/json` → global config → remote well-known.
- **Model specifier format**: `"providerID/modelID"` string (e.g., `"atomcli/minimax-m2.5-free"`). Split on first `/`.
- **Server default port**: 4096. Falls back to any available port if 4096 is taken.
- **`Instance.state()`** is the DI/singleton pattern for per-project cached state. Use it for any module that needs project-scoped initialization. Never use module-level mutable state unless it is explicitly bounded.
- **CORS**: Only `localhost:*`, `127.0.0.1:*`, `*.atomcli.ai` (https), and the configured whitelist are allowed. Tauri origins are explicitly allowed.

## Important locations

| Location                                         | Purpose                                                         |
| ------------------------------------------------ | --------------------------------------------------------------- |
| `AtomBase/src/integrations/tool/`                | All tool implementations                                        |
| `AtomBase/src/integrations/agent/agent.ts`       | Native agent definitions + permission defaults                  |
| `AtomBase/src/integrations/provider/provider.ts` | Provider registry, custom loaders, model resolution             |
| `AtomBase/src/core/config/config.ts`             | Config schema, loading order, agent/plugin/command file loading |
| `AtomBase/src/server/server.ts`                  | Hono server, route registration, CORS                           |
| `AtomBase/script/build.ts`                       | Cross-platform binary build (clears dist/, copies `.atomcli/`)  |
| `AtomBase/test/preload.ts`                       | Test environment setup (XDG dirs, provider key clearing)        |
| `AtomBase/test/tool/fixtures/`                   | Test fixtures incl. required `models-api.json`                  |
| `libs/sdk/js/src/v2/gen/`                        | Auto-generated SDK — do not edit manually                       |
| `.atomcli/` (repo root)                          | Bundled skills/agents — included in every release binary        |

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
