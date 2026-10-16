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

Ordinary coordinated turns advertise `todo` and `agent`; shared prompts match that surface and do not require the unavailable legacy `taskflow` tool. Checklists are optional. Existing durable taskflow obligations and explicit Atomic Work retain their lifecycle checks.

The classifier receives the full user request, including requirements beyond the former 1,000-character prefix. It may extract concise observable requested outcomes into the existing `acceptance` field; non-game criteria survive complexity enforcement. Explicit 3D-game requests retain their deterministic evidence contract. Extraction can still omit requirements, so the original durable objective remains authoritative; this is not a semantic completeness oracle or another planning phase.

Model history preserves settled tool results, including tool errors preceding a provider failure. It does not infer that a failed tool succeeded. Pruned tool outputs also stop replaying their attachments; durable originals remain stored. Bounded browser flows release held keys and mouse buttons on failure or cancellation, including holds created by nested input sequences. Successful explicit holds remain available to later flow steps.

## Skill disclosure and loading

Skills use progressive disclosure rather than injecting every instruction into every turn:

1. AtomCLI discovers skill names, descriptions, locations, and optional `trigger_words`.
2. Available names, descriptions, selected source, and shadowed paths are shown in the session context and the `skill` tool description.
3. A case-insensitive trigger-word match adds a lightweight `<skill_suggestion>` with at most three candidates. This is a hint, not an automatic load.
4. The agent compares the request with each description and calls the `skill` tool only when the skill is relevant.
5. Explicit skill names and reference paths resolve independently of suggestions. Allowed explicit skills load bounded root/reference chunks; missing and ambiguous requests stay visible.
6. Loading reports source, character ranges, catalog, and remaining offsets. Parent link labels rank task-relevant references; `offset`/`limit` loads subsequent chunks. Lexical routing and catalogs do not prove full reading. Compaction retains bounded loading history, reports shortening, and requires reloading bodies when needed.

Do not put large manuals in prompt core files or rely on broad trigger words as proof that a skill applies. Keep the skill description discriminating and the entrypoint compact. The built-in `atomcli-guide` follows this pattern so product help is discoverable without affecting unrelated coding requests.

Skill body reuse requires current-source chunks still present in active context. A durable read record or compaction summary alone does not establish body availability. Direct reference repeats reuse visible bodies; changed sources and bodies removed by compaction reload. Mandatory-read evidence remains a separate durable check.

Whole-library loading requires an explicit instruction such as “read all references”; general advice to select necessary references and phrases such as “reading list” retain bounded parent selection. Qualified reference paths load only the requested files, including when a skill has dependencies.

For frontend work, `frontend-design` keeps a short product brief in the existing plan and starts with a meaningful user journey. New playable games select the game-design reference and start with an objective, feedback, and restart. Browser verification uses actual pointer/keyboard input; helper calls remain diagnostics. One bounded experience review inspects desktop/narrow browser screenshots, identifies the strongest remaining user-impact weakness, batches material repairs and renews affected checks. DOM assertions do not establish visual quality. Tool attachments follow their tool call/result in model history and identify the originating call. Each image has an adjacent filename label so batched forward/narrow/reverse views remain identifiable when a provider omits image-file metadata. Remaining quality limitations are reported separately from functional acceptance. Optional visual polish and formatting remain advisory unless the user explicitly requires them; no visual-score completion gate or mandatory reviewer chain is added. Live output-quality comparisons and their separate correctness/experience rubric are described in [the eval guide](../AtomBase/evals/README.md).

The selected game 3D reference turns visual direction into scene decisions: world scale, purposeful placement, recognizable silhouettes, surface-aligned details, material/light separation, ground contact and gameplay-camera framing at both widths. For a 3D browser game, the default reference set is `game-design`, `3d-rendering`, `controls-and-camera`, and `testing-and-verification` plus `frontend-design`; load physics, browser, architecture, or performance references only when a concrete requirement needs them. The testing reference shows bounded condition-based physical input using existing browser actions. These replace generic repeated checklist text in those references; they add no aesthetic gate, renderer dependency or whole-library reading requirement.

Spatial review relates the actual mesh bounds to the rendered image: mesh width versus scale semantics, centered-box base/top coordinates, full attachment extents and facade orientation. A handwritten cube spanning `[-1,1]` requires half-dimension scale when its box helper accepts full dimensions; camera tuning cannot correct that geometry mismatch. Camera choices predict distance/FOV/pitch tradeoffs, then check narrow, quarter-turn and reverse frames. Passing gameplay alone does not prove this composition or visual reasoning succeeded.

The first visual check must dismiss onboarding and inspect the started scene. A near object filling the frame, an actor reduced to a dot, a single wall replacing the setting, or HUD controls hidden behind the canvas is a concrete composition failure; repair camera/large-form layout and stacking before adding detail.

Ask the model to record each visual review as `intent → visible result → spatial cause → repair tradeoff → recheck`; this makes “what should be better” concrete without introducing a new runtime gate.

Before implementation, the brief should name camera target/boom/FOV/pitch, intended actor and objective screen regions, and the landmark framing the route. These are testable spatial hypotheses, not permanent constants.

For active timing, do not replace an accumulator with `update(Math.min(delta, 0.05))`; that drops elapsed time on delayed callbacks. Bound catch-up steps after accumulating the full active delta.

Single-file/offline requirements constrain the delivered artifact; they do not automatically forbid a locally bundled renderer. Explicit no-dependency requirements still apply. The selected 3D guidance weighs modeling/lighting quality and implementation risk, preserves library licensing, and verifies offline delivery without runtime imports/CDN requests.

The game's existing experience-review step judges actor/goal recognition and camera framing from actual rendered forms. Source names and HUD text cannot substitute for a recognizable model or useful setting. It reports a visible weakness and the predicted benefit/tradeoff of a repair; it remains one bounded review rather than a new reviewer chain.

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

Every work turn receives the durable root objective and latest checkpoint reason. Compaction summaries preserve constraints, remaining work, and verification limits; history shortening alone does not prevent checkpoint generation. Checkpoint trigger consumption, repetition guards, and terminal lifecycle remain separate runtime controls.
