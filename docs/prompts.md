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

Active taskflows also receive a compact, synthetic progress checkpoint after every five distinct tool calls or five minutes. Time-based checkpoints are evaluated only when the next model turn begins; they do not wake an idle session. The injected snapshot is session-scoped, caps the number of rendered steps, escapes task names before placing them inside the XML-tagged reminder, and asks the agent to reconcile stale states rather than changing task status automatically. Reviewer, checker, explorer, and planner agents do not receive this reminder.

Prompt content can also be affected by project and global instructions, enabled skills, MCP configuration, selected agent, provider, permissions, and current session context.

## Skill disclosure and loading

Skills use progressive disclosure rather than injecting every instruction into every turn:

1. AtomCLI discovers skill names, descriptions, locations, and optional `trigger_words`.
2. Available names and descriptions are shown in the session context and the `skill` tool description.
3. A case-insensitive trigger-word match adds a lightweight `<skill_suggestion>` with at most three candidates. This is a hint, not an automatic load.
4. The agent compares the request with each description and calls the `skill` tool only when the skill is relevant.
5. Loading returns the `SKILL.md` body and its base directory. The agent follows relative links to only the supporting references required for the task.

Do not put large manuals in prompt core files or rely on broad trigger words as proof that a skill applies. Keep the skill description discriminating and the entrypoint compact. The built-in `atomcli-guide` follows this pattern so product help is discoverable without affecting unrelated coding requests.

## Change safely

1. Read `manager.ts` and the relevant prompt asset before changing text or order.
2. Keep static instructions in the appropriate asset directory; keep data that depends on an active project or session in runtime code.
3. Avoid duplicating platform policy across multiple files.
4. Run the focused prompt tests when present, then the standard AtomBase validation commands.
5. If skill availability, suggestion, or loading semantics change, update `docs/SKILLS-GUIDE.md`, the relevant prompt asset, and their regression tests together.

Project instructions are loaded through the configuration and session systems. `AGENTS.md` files participate in project rules; user-supplied agent and skill files extend the built-in behavior rather than replacing all native definitions.

## Related documents

- [Development guide](DEVELOPMENT.md)
- [Skills guide](SKILLS-GUIDE.md)
- [MCP guide](MCP-GUIDE.md)
