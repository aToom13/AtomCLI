# AtomCLI v3.4.1

This reliability-focused release strengthens file editing, language-server refactoring, isolated subagent execution, structured code review, remote operations, and browser workflows.

## Safe and Deterministic Editing

- Added content-hash guards so edits fail safely when a file changes after it was read.
- Added line-range anchors for disambiguating repeated text without weakening the existing fuzzy matching chain.
- Made multi-operation edits atomic, with one permission request and no partial write when a later operation fails.
- Added explicit protection against concurrent changes, oversized inputs, and stale anchor ranges.
- Added a provider-independent edit reliability benchmark covering guarded edits, ambiguity, stale state, large files, atomic operations, and fallback behavior.

## Language Server Refactoring

- Promoted the LSP tool into the default tool registry and expanded it with diagnostics, type definitions, workspace symbols, formatting, code actions, symbol rename, and file rename support.
- Added capability negotiation and dynamic capability tracking for language servers.
- Added transactional workspace edits with URI, range, document-version, and concurrent-change validation.
- Added rollback behavior for failed multi-file and resource operations.
- Restricted language-server subprocess environments so ambient credentials are not inherited.

## Typed and Isolated Subagents

- Added strict schema-validated subagent results and runtime capability requirements.
- Added isolated Git worktrees with bounded patch collection, conflict reporting, cleanup, and recovery behavior.
- Added live lifecycle events for subagent state, progress, tool activity, completion, failure, and cancellation.
- Preserved restrictive subagent permissions and added regression coverage for concurrency, isolation, cleanup, and schema failures.

## Structured Review V2

- Replaced free-form verdict parsing with Zod-validated reviewer output.
- Added bounded parallel reviewers with P0 through P3 severity, confidence, exact evidence, and deterministic overall verdicts.
- Validated every finding against the actual file path, line range, changed range, and source content before accepting it.
- Added finding deduplication and rejection of forged, stale, out-of-scope, or otherwise invalid findings.
- Added safe chunking for large diffs so oversized files are reviewed without silently dropping changes.
- Unified the review gate, isolated workflow quality checks, and CLI review command around the same validation core.
- Added GitHub pull request and GitLab merge request support with structured JSON reports.

## Tools and Runtime Reliability

- Added encrypted SSH profiles, host-key verification, bounded remote file operations, retry handling, and explicit approval boundaries.
- Improved browser target tracking, snapshots, session recovery, compact output, and end-to-end regression coverage.
- Unified public web and programming-documentation search through web and code modes.
- Removed the redundant standalone code-search path and specialized finance analyzer from the default tool registry.
- Improved workflow recovery, task association, subagent visibility, and narrow-terminal behavior in the TUI.

## Release and Compatibility

- Synced all Bun workspace package versions for this release.
- Preserved backward-compatible configuration defaults for reviewer concurrency and subagent isolation.
- Preserved the 12-target release matrix for Linux, macOS, and Windows, including musl and baseline x64 builds.
- Expanded ignore rules so local AtomCLI and Claude configuration, credentials, dependencies, plans, runs, caches, and session state cannot enter release commits.

## Validation

- Workspace typechecking and the complete deterministic Bun test suite pass.
- Edit reliability, real TypeScript language-server integration, isolated subagent execution, structured output validation, and Review V2 have focused regression coverage.
- Generated SDK files are synchronized and release metadata matches the exact version tag contract.
