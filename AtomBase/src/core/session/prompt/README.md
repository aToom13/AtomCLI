# Session prompt assets

This directory contains the static and runtime prompt pieces used by the session prompt manager. `manager.ts` is the assembly entrypoint; `core/`, `provider/`, `agent/`, and `runtime/` hold the corresponding instruction layers.

Read the manager and the relevant asset before changing prompt content or order. The maintained overview is [docs/prompts.md](../../../../../docs/prompts.md).

Skill names and descriptions are disclosed separately from full skill content. Trigger-word matches add only a suggestion, and the agent loads a relevant `SKILL.md` through the skill tool. Keep that contract synchronized across `system.ts`, `core/extensions.txt`, the prompt overview, and the skills guide.
