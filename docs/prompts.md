# Prompt Architecture

AtomCLI composes model instructions from prompt assets and runtime context. The implementation is centered in `AtomBase/src/core/session/prompt/manager.ts`; that file is the authority for assembly order and supported inputs.

## Prompt assets

```
AtomBase/src/core/session/prompt/
├── core/       shared instructions (identity, tools, workflow, communication, git safety, ...)
├── agent/      per-agent instructions (build, plan, explore, checker, reviewer)
├── runtime/    conditional reminders (plan mode, build switch, max-steps)
└── manager.ts  assembly entry point
```

`manager.ts` imports the `core/` and `agent/` text assets directly. The `runtime/` texts are conditional reminders injected by `AtomBase/src/core/session/prompt.ts` at specific points, such as the final step or while an agent is in plan mode.

Prompt content can also be affected by project and global instructions, enabled skills, MCP configuration, selected agent, provider, permissions, and current session context.

## Change safely

1. Read `manager.ts` and the relevant prompt asset before changing text or order.
2. Keep static instructions in the appropriate asset directory; keep data that depends on an active project or session in runtime code.
3. Avoid duplicating platform policy across multiple files.
4. Run the focused prompt tests when present, then the standard AtomBase validation commands.

Project instructions are loaded through the configuration and session systems. `AGENTS.md` files participate in project rules; user-supplied agent and skill files extend the built-in behavior rather than replacing all native definitions.

## Related documents

- [Development guide](DEVELOPMENT.md)
- [Skills guide](SKILLS-GUIDE.md)
- [MCP guide](MCP-GUIDE.md)
