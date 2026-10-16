# RPG game recipe

Use for role-playing games with progression, inventory, dialogue, quests, party choices, or combat builds. Pick requested core fantasy and smallest decision loop before building a world database. Read `../game-design.md` for player promise, `../architecture.md` for state ownership, and `../ui-feedback.md` for dialogue and inventory feedback.

## First playable loop

Talk to one character, accept a clear objective, make a meaningful equipment/ability choice, resolve encounter, receive reward, and save/reload. If combat is not requested, replace encounter with exploration or social decision that changes state. Inventory and quest screens must show actual state changes; a static journal is not a quest system.

## State model

Define stable IDs for items, quests, actors, locations, dialogue nodes, and abilities. Keep definitions separate from per-save mutable state: possession count, quest phase, flags, cooldowns, and relationship values. Validate references at content load; missing item or dialogue IDs should fail visibly during development. Save atomically with schema version, restore all gameplay state, and migrate or reject incompatible saves explicitly. Never use display name as persistence key.

Quest transitions need preconditions, effects, and repeatability policy. Prevent duplicate rewards when dialogue or a trigger fires twice. Inventory operations need capacity, stack rules, equip restrictions, and rollback on failed transaction. Dialogue choices should preview enough consequence for informed decisions when intended; avoid false choice where all options silently produce same state.

## Combat and progression balance

Write expected damage, survival time, resource income/spend, and level curve before adding many stats. Compare options within intended audience and level band. Different builds can be situationally strong without equal raw numbers; look for dominated choices and mandatory strategies. Random loot needs probability, player utility, and perceived fairness checks. Limit grind loops that unlock progress without meaningful decisions unless genre promise explicitly includes them.

Enemy scaling should preserve earlier gains. If enemies always scale exactly with player power, progression can feel ineffective; if they never scale, content may become trivial. Use benchmark encounters at several levels and measure completion, resource use, and time. A playtest is needed to validate perceived agency; formulas alone cannot prove it.

## Interface and acceptance runs

Show quest objective, current location, selected equipment, resource cost, and consequence of failure at the moment needed. Keyboard/controller focus must stay visible in inventory and dialogue. Test save during quest transition, duplicate trigger, full inventory reward, missing content ID, load after restart, and repeated conversation. Verify that a fresh player can understand next action without an external design document.

## Sources reviewed

- Game Programming Patterns, state management: https://gameprogrammingpatterns.com/state.html
- Community game-balance skill, progression and random reward reasoning; adapted, not copied: https://github.com/Yuki001/game-dev-skills/blob/main/skills/game-balance-analysis/SKILL.md
- Community game-design review skill, player choice evidence; adapted, not copied: https://github.com/Yuki001/game-dev-skills/blob/main/skills/game-design-review/SKILL.md
