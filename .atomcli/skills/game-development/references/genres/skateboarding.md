# Skateboarding game recipe

Use when player skates, jumps, performs aerial tricks, grinds, or links scored landings. Preserve requested renderer, language, asset, file-count, and platform constraints. Read `../physics-and-timing.md`, `../controls-and-camera.md`, and `../testing-and-verification.md` for implementation details.

## First playable loop

Player must visibly push, coast, steer, ollie over a low obstacle, land, receive points, and restart after a fall. Put one curb, one ramp, and one rail within short travel distance before building a city. Show actual controls and score in game. A skatepark with decorative rails that cannot be used is incomplete.

## Movement and contact

Represent board position, heading, horizontal velocity, vertical velocity, and grounded contact separately. Pushing adds acceleration in board direction; coasting loses speed through friction; turning depends on speed and contact without causing instant lateral teleport. Ground contact uses surface normal and height, so a ramp changes takeoff trajectory. Use fixed or bounded physics steps; test same jump at slow and fast frame rates. Collision shapes must match visible ledges and rails closely enough for player decisions.

Use explicit states such as ground, air, grind, and bail. Ollie uses an input edge and a small documented buffer/coyote window if desired; holding jump must not repeatedly pop. Takeoff records trick start and previous ground contact. Air rotation and flip inputs animate board/rider and update trick progress independently. On landing, compare board orientation and vertical speed to tolerances. A partial flip or bad orientation should bail or receive reduced credit, not silently score as completed trick. Keep rider/board contact readable at low camera angles.

## Rails and grinds

A grind begins only when airborne board crosses rail contact region with compatible position, descent, and motion direction. Give rail a longitudinal axis, finite endpoints, and entry/exit rules. While grinding, constrain board to rail, retain or decay along-rail speed, and let input balance or steer if game design calls for it. Do not snap from arbitrary nearby positions or grind forever after leaving rail. Test crossing rail from both directions, landing next to it, low-speed entry, endpoint exit, and jump-out into a new trick.

## Score and combos

Score completed trick families (ollie, flip, spin, grind) once per landing or grind exit. Rotation amount should use actual completed quarter/half/full turns with a tolerance, not frame count alone. Prevent holding flip input from generating unlimited points without a valid completed rotation. Apply multiplier to a linked sequence only while its landing/grind timing rule holds; reset on bail or expired link window. Show trick name, base points, multiplier, total, and reason for failed landing. Tune point values so safe repetitive tricks do not dominate every line; compare representative routes with a small simulation or recorded play traces.

## Camera and level checks

Follow velocity and board direction smoothly without losing upcoming obstacle visibility. Keep horizon and landing zone visible through jumps; avoid clipping through storefronts or geometry. Handrails, curbs, benches, ramps, and transitions need collision and scoring behavior consistent with their visual shape. NPCs should not block a test route unpredictably; use seeded movement or marked collision rules. Water may be visual, collision hazard, or traversable surface, but behavior must be explicit.

## Acceptance runs

- From fresh launch, complete ollie and one scored trick without external assets or setup beyond declared runtime libraries.
- Repeat same jump at 30, 60, and 120 FPS; landing and score remain materially consistent.
- Attempt partial flip, over-rotation, low-speed rail entry, rail endpoint, and bail; score cannot inflate.
- Link two clean tricks, then bail; multiplier rises and resets visibly.
- Pause, resize, reset, and relaunch; input state does not stick.

## Sources reviewed

- Game Programming Patterns, state: https://gameprogrammingpatterns.com/state.html
- Glenn Fiedler, fixed timestep: https://gafferongames.com/post/fix_your_timestep/
- Community game-balance skill, evidence-based tuning; concepts adapted, not copied: https://github.com/Yuki001/game-dev-skills/blob/main/skills/game-balance-analysis/SKILL.md
