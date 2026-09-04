# AtomCLI Documentation Summary

AtomCLI is a Bun-based terminal AI coding assistant. Its interactive interface, headless server, ACP endpoint, provider registry, MCP integration, skills, and session storage live in `AtomBase/`.

The repository version is defined by `AtomBase/package.json`; do not duplicate it in prose because the package and release version can change independently.

## Source of truth

| Topic                               | Authoritative location                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| CLI commands and options            | `AtomBase/src/index.ts` and `AtomBase/src/interfaces/cli/cmd/`                          |
| Configuration schema and precedence | `AtomBase/src/core/config/config.ts`                                                    |
| Global paths                        | `AtomBase/src/core/global/index.ts`                                                     |
| Provider registry and catalog       | `AtomBase/src/integrations/provider/`                                                   |
| MCP configuration                   | `AtomBase/src/core/config/config.ts` and `AtomBase/src/integrations/mcp/`               |
| Prompt assembly                     | `AtomBase/src/core/session/prompt/manager.ts`                                           |
| Skill discovery and loading         | `AtomBase/src/integrations/skill/`, `AtomBase/src/integrations/tool/skill.ts`           |
| Skill suggestions                   | `AtomBase/src/core/session/system.ts` and prompt `core/extensions.txt`                  |
| HTTP routes and SDK generation      | `AtomBase/src/server/` and `libs/sdk/js/`                                               |
| Companion listeners and pairing     | `AtomBase/src/interfaces/cli/network.ts`, `AtomBase/src/server/`, and `libs/companion/` |
| Android Companion behavior          | `companion/` and `companion/README.md`                                                  |
| Agent-quality evaluation            | `AtomBase/src/core/eval/` and `AtomBase/evals/`                                         |
| Stale-safe file editing             | `AtomBase/src/integrations/tool/edit.ts` and `edit-anchor.ts`                           |
| Language-server refactoring         | `AtomBase/src/integrations/lsp/` and `AtomBase/src/integrations/tool/lsp.ts`            |
| Typed and isolated subagents        | `AtomBase/src/integrations/tool/subagent*.ts`                                           |
| Structured review validation        | `AtomBase/src/core/verification/review-v2.ts` and review entry points                   |
| Ignore and local-state policy       | `.gitignore`, `AtomBase/.gitignore`, and `AGENTS.md`                                    |
| Release trigger and artifacts       | `.github/workflows/release.yml` and `AtomBase/script/build.ts`                          |
| Bundled AtomCLI runtime guide       | `.atomcli/skills/atomcli-guide/`                                                        |

Use the guides in this directory for operational guidance. When behavior changes, update the relevant guide and matching `atomcli-guide` reference in the same change. Verify commands with `atomcli --help` or the corresponding source, and use the AtomCLI-native skill test for bundled guide changes.
