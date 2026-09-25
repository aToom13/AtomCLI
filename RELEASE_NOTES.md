# AtomCLI v3.4.4-debug

AtomCLI 3.4.4-debug is a prerelease focused on live Cline model discovery, stable project identity in Git worktrees, and more reliable cross-platform installation. Companion remains a beta product under active development; Android, iOS, background execution, and OEM integrations are not universally stable.

## Providers and Models

- Added a first-party `cline-pass` API-token provider that loads the complete live Cline `/models` catalog without the OAuth free-only filter.
- Added current Cline Pass aliases from `recommended-models.clinePass` and refreshes the catalog while AtomCLI runs.
- Preserved the existing `cline` browser OAuth behavior: only promoted free models and catalog IDs ending in `:free` are exposed.
- Preserved published pricing when available, explicitly classified `:free` entries as free, and labeled Cline Pass aliases as subscription access.

## Project and Worktree Reliability

- Stored project identity in the shared Git directory so primary checkouts and linked or isolated worktrees use the same project ID.
- Added regression coverage for normal Git worktrees and isolated sub-agent workspaces.

## Installer Reliability

- Added automatic baseline x64 binary selection for processors without AVX2, with `ATOMCLI_BASELINE=1` available as an explicit override.
- Added baseline release coverage for glibc, musl, and Windows assets.
- Added bounded retries and connection timeouts for release and skills downloads.
- Hardened Windows PowerShell 5.1 handling for native command stderr, exit-code validation, non-interactive prompts, Bun installation, source builds, Chromium verification, and installed binary verification.

## Companion Beta

- Added clearer Flutter SDK path validation during Android project configuration.
- Companion remains beta. Android, iOS, background execution, and OEM integrations are not universally stable.

## Validation

- AtomBase typecheck passed.
- AtomBase test suite passed: 1,770 tests passed, 10 opt-in tests skipped, 0 failed.
- Bundled `atomcli-guide` validation passed.
- Unix installer fixture tests passed.
- Live Cline checks exposed 25 OAuth free models and 474 API-token models at validation time.
- PowerShell installer tests and ShellCheck remain CI-validated because `pwsh` and `shellcheck` were unavailable locally.

Version `3.4.4-debug` is released only by pushing the exact `v3.4.4-debug` tag.
