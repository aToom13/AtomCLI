# Development Guide

## Requirements

- Bun 1.3.10
- Git

Use Bun only; this repository does not use npm or Yarn. The monorepo root delegates workspace tasks, while the primary application package is `AtomBase/`.

## Repository layout

| Location                   | Purpose                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `AtomBase/`                | CLI, TUI, server, providers, tools, sessions, and configuration                    |
| `libs/sdk/js/`             | Generated JavaScript/TypeScript SDK                                                |
| `libs/companion/`          | Companion pairing, mobile bridge, and discovery library                            |
| `companion/`               | Flutter companion application                                                      |
| `.atomcli/` and `.claude/` | Tracked skills and agents copied into release artifacts; runtime state stays local |
| `docs/`                    | Maintained user and developer documentation                                        |

## Run locally

```sh
cd AtomBase
bun run dev
```

The development command runs with Bun's `browser` condition, which is required for TUI imports. To inspect commands without starting an interactive workflow:

```sh
bun run --conditions=browser ./src/index.ts --help
```

## Validation

Run package checks from `AtomBase/`:

```sh
bun run typecheck
MODELS_DEV_API_JSON=test/tool/fixtures/models-api.json bun test
```

Run workspace checks from the repository root:

```sh
bun turbo typecheck
bun turbo test
```

The models.dev fixture is the required test convention. `test/preload.ts` copies that fixture into the isolated test data directory, so the standard test suite does not require a live models.dev request.

## Build and release

```sh
cd AtomBase
bun run build
```

`AtomBase/script/build.ts` removes `dist/` before each build, bundles the application for supported targets, and includes root `.atomcli/` and `.claude/` assets. Do not store source files in `dist/`.

Pushing a `v*` Git tag is the only automated release trigger. The supported release entrypoint is the root `release.sh`; do not manually publish generated release directories.

Release jobs run from a clean checkout. The build copies root `.atomcli/` and `.claude/` directories, so only tracked, reviewable skills and agents belong there. Local configuration, credentials, package manifests/locks, installed dependencies, plans, runs, and session state must remain ignored.

The build matrix produces Linux x64/ARM64 (glibc and musl), macOS x64/ARM64, and Windows x64/ARM64 executables. x64 baseline variants cover older processors without AVX2. Bun has no FreeBSD runtime or compile target, so FreeBSD cannot be advertised as a supported AtomCLI runtime; platform-specific helpers should still fail clearly or use a system executable where possible.

### Pre-release repository check

Prepare `AtomBase/package.json` and `RELEASE_NOTES.md`, then run the complete release audit without changing Git or contacting GitHub:

```sh
./release.sh --dry-run
```

The dry run installs the locked Bun dependencies, runs workspace typechecks and tests, constructs the candidate commit in a temporary Git index, checks ignored/tracked conflicts, rejects local runtime artifacts, scans for common credential signatures, and validates that the release note contains no emoji.

The underlying repository checks are:

```sh
git status --short
git status --short --ignored
git ls-files -ci --exclude-standard
git ls-files --others --exclude-standard
```

Review every tracked and untracked path. `git ls-files -ci --exclude-standard` must print nothing: a tracked file hidden by an ignore rule can otherwise change without appearing in normal status output. Do not force-add local `.atomcli/` or `.claude/` state. Do not commit `AtomBase/dist/`, `release_assets/`, logs, credentials, or generated test sandboxes.

The release version is sourced from `AtomBase/package.json`. To perform the authorized release:

```sh
./release.sh
```

The script requires authenticated GitHub CLI access. It displays the working tree and requires the exact version tag as confirmation, safely syncs a behind-only `main` branch with autostash, validates the repository, commits all non-ignored changes, pushes `main`, creates and pushes only the exact release tag, and waits for `.github/workflows/release.yml` to publish the GitHub release. It aborts on divergent history, merge conflicts, an existing tag, failed validation, or a failed release workflow.

## Configuration

The configuration schema is `AtomBase/src/core/config/config.ts`. Its precedence, from highest to lowest, is:

1. `ATOMCLI_CONFIG_CONTENT`
2. Project `atomcli.jsonc`, `atomcli.json`, or `mcp.json`
3. The file specified by `ATOMCLI_CONFIG`
4. Global files in `~/.atomcli/`
5. Remote well-known configuration

Global files include `config.json`, `atomcli.json`, `atomcli.jsonc`, and `mcp.json`. New configuration fields must remain backward compatible and optional with defaults.

## Architecture

| Concern                      | Location                                    |
| ---------------------------- | ------------------------------------------- |
| CLI registration             | `AtomBase/src/index.ts`                     |
| CLI commands and TUI         | `AtomBase/src/interfaces/cli/cmd/`          |
| Configuration                | `AtomBase/src/core/config/config.ts`        |
| Project-scoped state         | `AtomBase/src/services/project/instance.ts` |
| Sessions and prompt assembly | `AtomBase/src/core/session/`                |
| Providers                    | `AtomBase/src/integrations/provider/`       |
| Tools                        | `AtomBase/src/integrations/tool/`           |
| MCP                          | `AtomBase/src/integrations/mcp/`            |
| Server routes                | `AtomBase/src/server/`                      |

Follow the namespace export pattern and use path aliases (`@/*`, `@tui/*`). Code built with `--conditions=browser` must use type-only imports for `ai` and dynamic imports for its runtime use.

## Server API and SDK

After changing `AtomBase/src/server/` routes, regenerate and build the SDK:

```sh
cd AtomBase
bun run dev generate > ../libs/sdk/js/openapi.json
cd ../libs/sdk/js
bun run build
```

Do not manually edit `libs/sdk/js/src/v2/gen/`; it is generated.

## Documentation maintenance

Keep documentation tied to its source of truth. Validate command examples with `atomcli --help`, configuration examples against `Config.Info`, and SDK claims against `libs/sdk/js/`. Avoid hard-coded provider counts, model lists, and package versions unless a release artifact requires them.
