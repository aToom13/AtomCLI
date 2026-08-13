# AtomBase source tree

| Directory       | Responsibility                                                                        |
| --------------- | ------------------------------------------------------------------------------------- |
| `core/`         | configuration, global paths, sessions, storage, IDs, snapshots, and shared core state |
| `integrations/` | providers, agents, tools, MCP, ACP, browser, plugins, skills, and language servers    |
| `interfaces/`   | CLI commands, terminal UI, command interfaces, flags, and formatting                  |
| `server/`       | Hono server, route registration, companion bridge, and API routes                     |
| `services/`     | project instances, installation, authentication, files, patches, and worktrees        |
| `util/`         | Bun, permission, sharing, and general utility code                                    |

`index.ts` registers the CLI. `shim.ts` establishes runtime compatibility before command imports. Use `@/*` and `@tui/*` aliases instead of long relative imports.

For architecture and validation requirements, see the [development guide](../../docs/DEVELOPMENT.md).
