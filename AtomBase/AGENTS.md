# AGENTS.md

## Must-follow constraints

- **Bun only** — do not use npm or Yarn. The repository pins `bun@1.3.10`.
- Run with `bun run --conditions=browser ./src/index.ts`. The `--conditions=browser` flag is required for TUI and SolidJS imports. The build also uses `conditions: ["browser"]`. Missing this flag causes silent import failures.
- `@/*` → `./src/*`, `@tui/*` → `./src/interfaces/cli/cmd/tui/*`. Use path aliases; never use relative `../../` chains across directory boundaries.
- **`ai` package**: use `import type` for types only. For runtime calls, use `await import(...)`. Top-level `import` from `ai` under `--conditions=browser` causes Bun ESM resolution failures.
- New tools must use `Tool.define()` in `src/integrations/tool/`. The wrapper validates Zod schemas, auto-truncates output at 2000 lines / 50 KB. Only set `metadata.truncated` yourself if your tool handles truncation internally.
- New native agents must be added to the `state` factory in `src/integrations/agent/agent.ts`. Custom user agents come from `.atomcli/agent/*.md` with YAML frontmatter — they extend native agents, not replace them.
- `strict: false` in `tsconfig.json` is intentional. Do not enable strict mode.
- After changing a route under `src/server/`, regenerate the SDK from this directory with `bun run dev generate > ../libs/sdk/js/openapi.json`, then run `cd ../libs/sdk/js && bun run build`. Never hand-edit `../libs/sdk/js/src/v2/gen/`.
- Releases are triggered only by `v*` tags. Root `release.sh` is the supported release entrypoint. Never push a commit or tag, publish a package, or add generated release output without explicit user authorization.
- Root `.atomcli/` and `.claude/` contain tracked release assets. Their local config, credentials, package manifests/locks, dependencies, plans, runs, and session state must stay ignored.

## Validation before finishing

```sh
# Typecheck (uses tsgo, not tsc)
bun run typecheck

# Full test suite
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json bun test

# Single test file
bun test test/tool/tool.test.ts
```

## Repo-specific conventions

- **Namespace pattern**: All modules export a named namespace (`Tool`, `Session`, `Config`, `Provider`, `Agent`). No bare top-level exports.
- **DI/singleton**: Use `Instance.state()` for per-project cached state. No unbounded module-level mutable state.
- **Logging**: `Log.create({ service: "name" })` in every module that logs.
- **Config precedence** (highest first): `ATOMCLI_CONFIG_CONTENT` env → project `atomcli.jsonc/json` or `mcp.json` → `ATOMCLI_CONFIG` file → global config → remote well-known.
- **Model specifier**: `"providerID/modelID"` string, split on first `/`.
- **Tool `execute()` return**: must be `{ title: string, output: string, metadata: M }`. The `metadata.truncated` field gates the automatic truncation wrapper.
- **Agent permission defaults**: `*.env` and `*.env.*` files are denied by default (read) except `*.env.example`. `question` tool is denied by default for subagents.
- **Orchestrate workflow**: always plan first (`action="plan"`), then execute (`action="execute"`) with the returned `workflowId`. Sub-agents always deny `todowrite`, `todoread`, and `task`.

## Important locations

| Location                                | Purpose                                                      |
| --------------------------------------- | ------------------------------------------------------------ |
| `src/integrations/tool/`                | All tool implementations                                     |
| `src/integrations/agent/agent.ts`       | Native agents + permission defaults                          |
| `src/integrations/provider/provider.ts` | Provider registry, custom loaders                            |
| `src/core/config/config.ts`             | Config schema, loading order, agent/plugin file loaders      |
| `src/server/server.ts`                  | Hono server, all routes wired here                           |
| `test/preload.ts`                       | Test env setup — XDG dirs, provider key cleanup              |
| `test/tool/fixtures/`                   | Test fixtures; `models-api.json` required for provider tests |
| `script/build.ts`                       | Cross-platform binary build; copies `../.atomcli/` into dist |

Before release preparation, run `git ls-files -ci --exclude-standard` from the repository root. It must produce no output; a tracked file must never be hidden by an ignore rule.

## Change safety rules

- `Tool.Info` return shape must not change without updating all tool implementations.
- `AGENT_SESSION_MAP` key in `orchestrate.ts` is `"parentSessionId:agentType:taskId"`. Changing format breaks `purgeSessionMapForWorkflow`.
- `Config.Info` schema must stay backward-compatible. New fields must be optional with defaults.
- `WORKFLOWS` map is bounded to `MAX_WORKFLOWS = 100`. Do not remove this bound.

## Known gotchas

- `bun test` without `MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json` fails silently on provider tests.
- `test/preload.ts` sets XDG env vars. Any `src/` import that runs before preload gets real user config paths — corrupting test isolation.
- `antigravity` provider's model list is deliberately cleared in `provider.ts`. Do not restore it.
- `privatemode-ai` is a runtime mock alias. Do not remove it.
- Edit tool uses a 9-replacer fallback chain for fuzzy matching. Failures throw; they do not silently no-op. If `oldString` matches multiple locations, you must add more surrounding context.
- `bun run build` runs `rm -rf dist` unconditionally. Never store files in `dist/`.
