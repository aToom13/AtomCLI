# Tool registry notes

`taskflow` is the primary planning and progress tool exposed to agents. It publishes the TUI chain events used to render progress and coordinates the review gate when a task is cleared.

The legacy `chainupdate`, `todowrite`, and `todoread` tool implementations were removed. Their permission keys and historical-session renderers remain backward-compatible, while `taskflow` is the only registered planning interface.

Skill installation is the `skill` tool's `add` action; do not add a second installer tool. MCP configuration remains a CLI/config-file workflow, and process lifecycle operations remain outside the agent tool registry. The old heuristic `test_gen`, `docs`, `refactor`, and `review` tool wrappers were removed; their dedicated CLI commands are independent implementations.

When changing tool registration, verify `AtomBase/src/integrations/tool/registry.ts`, agent allow lists, permission rules, and the corresponding tests. The tool wrapper owns schema validation and output truncation; tool implementations must preserve the `Tool.Info` result shape.
