# Prompt Architecture

AtomCLI composes model instructions from prompt assets and runtime context. The implementation is centered in `AtomBase/src/core/session/prompt/manager.ts`; that file is the authority for assembly order and supported inputs.

## Prompt assets

```
AtomBase/src/core/session/prompt/
├── core/       shared instructions
├── provider/   provider-specific instructions
├── agent/      agent-specific instructions
├── runtime/    dynamic runtime sections
└── manager.ts  assembly entry point
```

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
