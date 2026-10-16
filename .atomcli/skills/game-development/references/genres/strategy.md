# Strategy game recipe

Use for turn-based or real-time strategy built around planning, units, resources, territory, or tactical positioning. Decide match length, information visibility, and player decision scale before systems multiply. Read `../game-design.md`, `../ai-and-worlds.md`, and `../testing-and-verification.md` for shared rules.

## First playable loop

Player selects unit or action, sees legal choices and cost, commits one move, observes opponent/world response, reaches a win or loss condition, and restarts. A map editor or unit catalog without this loop is incomplete. Display turn/phase, resources, legal targets, and consequence preview as relevant.

## Rules and determinism

Represent game state separately from view. One authoritative transition function should validate action preconditions, spend resources, resolve effects, advance phase, and check victory. Invalid actions leave state unchanged and explain why. Seed random outcomes and record action log so a reported match can replay. If multiplayer, define authority and desync detection separately; local deterministic replay is not network trust.

For turn-based games, define simultaneous orders versus strict order, priority, tie-breaking, reaction windows, and end-of-turn effects. For real-time games, fixed simulation ticks, command queue ordering, and bounded unit counts matter. Avoid rules whose result depends on UI animation completion or machine frame rate.

## Pathfinding and information

Choose grid/navmesh graph, legal neighbors, terrain cost, occupied-cell policy, and movement range. Use A* or another pathfinder only after verifying edge costs and blocked cells; a short path can still be illegal if it crosses hidden or occupied terrain. Fog of war must not leak hidden enemy state through path previews, selection highlights, AI behavior, or logs. Decide whether unseen terrain remains remembered and how stale intel is shown.

AI should use same legal-action API as player where possible. Tune across several maps and initial positions; a strategy that wins only because AI sees hidden state or ignores costs is not valid difficulty. Distinguish transitive upgrades from counters and situational choices in balance analysis. Resource loops must have viable opening, midgame, and recovery states.

## Acceptance runs

- Replay same seed and action log; final state/hash matches.
- Try insufficient resources, blocked move, illegal target, and action during wrong phase; no partial state mutation.
- Run pathfinding around dynamic blocker and through variable-cost terrain; legal path and displayed cost agree.
- Test both sides, several maps, first/second turn, stalemate, surrender or timeout, and restart.
- Inspect fog from player view and AI information boundary; hidden units remain hidden until revealed.

## Sources reviewed

- Red Blob Games, A* and movement costs: https://www.redblobgames.com/pathfinding/a-star/introduction.html
- Godot navigation concepts: https://docs.godotengine.org/en/stable/tutorials/navigation/index.html
- Community game-balance skill, intransitive and situational options; adapted, not copied: https://github.com/Yuki001/game-dev-skills/blob/main/skills/game-balance-analysis/SKILL.md
