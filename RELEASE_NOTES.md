# AtomCLI v3.3.8

AtomCLI v3.3.8 focuses on a more responsive terminal interface, a clearer model-selection workflow, leaner runtime code, and safer release preparation.

## Terminal interface

- Reworked responsive layout behavior for the session header, task plan, prompt area, side panels, and short or narrow terminals.
- Centered dialogs vertically and horizontally while keeping them within the available terminal dimensions.
- Improved scrolling so the highlighted option remains visible when navigating long lists with the arrow keys.
- Added clearer keyboard shortcut hints and a more resilient slash-command experience.

## Model selection

- Redesigned the `/model` and `/models` picker with search across model names, identifiers, providers, and capabilities.
- Added recent and favorite model sections, free-model and reasoning filters, detailed model information, and visible keyboard actions.
- Marked ChatGPT and Codex OAuth models as subscription access instead of incorrectly presenting them as free.
- Prevented the model dialog from crashing when selection changes or model metadata is incomplete.

## CLI and reliability

- Removed the unused web dashboard while retaining the headless server and API workflows required by CLI, SDK, ACP, and companion integrations.
- Added shell completion support, improved file search and session recovery, and strengthened TUI behavior across terminal sizes.
- Simplified legacy tool registration and consolidated planning progress around TaskFlow.
- Improved provider catalog handling, configuration precedence, authentication safety, and error recovery.

## Development and release safety

- Updated the project release version to 3.3.8.
- Added broader CI, platform smoke testing, installer validation, and generated SDK checks.
- Fixed Windows ARM64 release packaging by including its native file-watcher binding and aligning watcher packages across release targets.
- Tightened ignore rules so local configuration, credentials, dependencies, logs, plans, runs, session data, build output, and release staging files remain local.
- Updated repository documentation, development instructions, provider guidance, skill guidance, MCP guidance, prompt architecture, and release hygiene checks.

## Validation

- Workspace typechecks pass with Bun.
- The complete workspace test suite passes with the pinned models fixture.
- Markdown links, skill frontmatter, secret signatures, tracked-ignore conflicts, and release metadata are checked before publishing.
