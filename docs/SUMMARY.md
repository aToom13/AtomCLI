# AtomCLI Documentation Summary

AtomCLI is a Bun-based terminal AI coding assistant. Its interactive interface, headless server, ACP endpoint, provider registry, MCP integration, skills, and session storage live in `AtomBase/`.

The repository version is defined by `AtomBase/package.json`; do not duplicate it in prose because the package and release version can change independently.

## Source of truth

| Topic                               | Authoritative location                                                    |
| ----------------------------------- | ------------------------------------------------------------------------- |
| CLI commands and options            | `AtomBase/src/index.ts` and `AtomBase/src/interfaces/cli/cmd/`            |
| Configuration schema and precedence | `AtomBase/src/core/config/config.ts`                                      |
| Global paths                        | `AtomBase/src/core/global/index.ts`                                       |
| Provider registry and catalog       | `AtomBase/src/integrations/provider/`                                     |
| MCP configuration                   | `AtomBase/src/core/config/config.ts` and `AtomBase/src/integrations/mcp/` |
| Prompt assembly                     | `AtomBase/src/core/session/prompt/manager.ts`                             |
| HTTP routes and SDK generation      | `AtomBase/src/server/` and `libs/sdk/js/`                                 |
| Ignore and local-state policy       | `.gitignore`, `AtomBase/.gitignore`, and `AGENTS.md`                      |
| Release trigger and artifacts       | `.github/workflows/release.yml` and `AtomBase/script/build.ts`            |

Use the guides in this directory for operational guidance. When behavior changes, update the relevant guide in the same change and verify its commands with `atomcli --help` or the corresponding source.
