# Platformer game recipe

Use for jump-and-run games where traversal timing, collision, and readable level geometry determine play. Choose precision, momentum, or forgiving exploration feel from user's request. Read `../physics-and-timing.md`, `../controls-and-camera.md`, and `../testing-and-verification.md` for engine-independent implementation checks.

## First playable loop

Move, jump a gap, land on one platform, reach visible goal, restart after fall. Make one short test level before a tile set or procedural generator. Collision silhouette must match what players see. Explain movement, jump, pause, and restart in opening view or HUD; do not require reading source code.

## Controller contract

Separate horizontal acceleration, maximum speed, ground friction, air control, gravity, jump impulse, and terminal fall speed. Use contact normals to distinguish floor, wall, and ceiling. Decide whether jump is variable-height, fixed-height, double jump, wall jump, or none; implement only requested abilities. A small input buffer and coyote window can make timing forgiving, but define ceilings and test them so multiple jumps do not occur from one held key. Release of input must clear movement even after focus loss or pause.

Move player and solve collisions in a stable order. Test corners, thin platforms, one-way platforms, slopes, moving platforms, and ceilings only if level uses them. Moving platforms need explicit carry behavior; otherwise player slips or teleports. High fall speed requires swept collision or enough physics steps to prevent tunneling. If engine offers a native character controller, use it before writing bespoke collision response; confirm its floor-angle and snap settings fit the level.

## Level grammar and difficulty

Introduce one mechanic safely, demand it once with a clear failure margin, then combine it with prior mechanics. Estimate reachable gap width and height from controller parameters; test every required jump at minimum and maximum intended speed. Place hazards where player can see and react, and checkpoint before a long repeated section. Camera should reveal upcoming landing area; off-screen hazards and camera snapping are difficulty bugs, not skill tests.

For procedural levels, build from validated chunks with entry/exit conditions. Enforce reachability across chunk boundaries, bound consecutive high-difficulty segments, and keep a seed to reproduce failures. Decorative tiles must not imply collision where none exists. Score or collectibles should reward optional risk without making mandatory progression obscure.

## Acceptance runs

- Jump pressed just before landing and just after leaving ledge follows documented buffer/coyote rules.
- Hold, tap, and release jump produce expected heights; ceiling contact stops ascent.
- Cross every required gap with intended speed range; fail and restart without lingering momentum.
- Test lower frame rate, pause, resize, focus loss, and moving platform transitions.
- For generated stages, run seeded reachability checks plus a human play pass.

## Sources reviewed

- Godot CharacterBody2D controller behavior: https://docs.godotengine.org/en/stable/classes/class_characterbody2d.html
- Game Programming Patterns, state transitions: https://gameprogrammingpatterns.com/state.html
- Community game-design review skill, player decision and playtest evidence; adapted, not copied: https://github.com/Yuki001/game-dev-skills/blob/main/skills/game-design-review/SKILL.md
