---
name: game-development
dependencies:
  - name: frontend-design
    when: [web, browser, html, chrome, tarayıcı]
description: Design, implement, and verify playable games across browser and native platforms, including 2D, 3D, controls, physics, camera, AI, UI, audio, performance, and release checks. Use for game creation or gameplay changes; skip reviews and unrelated 3D models.
trigger_words: [playable game, 2d game, 3d game, game development, gameplay system, game physics, game loop, game mechanics, browser game, skateboarding game, oyun geliştir, oynanabilir oyun, 3d oyun, oyun fiziği, oyun mekaniği, oyun döngüsü]
---

# Game development

Keep platform, language, asset, renderer, input, and file-count constraints exact. Build a playable loop before polish. Separate simulation, input, rendering, UI, persistence, and platform integration so each can be tested.

## Route to references

- Planning and game feel: [references/game-design.md](references/game-design.md) — select for playable-game creation; define the player verb, goal, risk/reward, and first meaningful loop before technical implementation.
- Architecture and production loop: [references/architecture.md](references/architecture.md)
- Timing, physics, and collisions: [references/physics-and-timing.md](references/physics-and-timing.md)
- 3D rendering, camera, lighting, and assets: [references/3d-rendering.md](references/3d-rendering.md)
- Controls, traversal, and camera feel: [references/controls-and-camera.md](references/controls-and-camera.md)
- UI, feedback, scoring, accessibility: [references/ui-feedback.md](references/ui-feedback.md)
- Browser and WebGL games: [references/browser-games.md](references/browser-games.md)
- Native C/C++ games: [references/native-cpp.md](references/native-cpp.md)
- AI and world simulation: [references/ai-and-worlds.md](references/ai-and-worlds.md)
- Audio and presentation: [references/audio-and-presentation.md](references/audio-and-presentation.md)
- Testing and runtime verification: [references/testing-and-verification.md](references/testing-and-verification.md)
- Performance and memory: [references/performance.md](references/performance.md)
- Genre recipes: [skateboarding](references/genres/skateboarding.md), [racing](references/genres/racing.md), [platformer](references/genres/platformer.md), [shooter](references/genres/shooter.md), [RPG](references/genres/rpg.md), [strategy](references/genres/strategy.md), and [endless runner](references/genres/endless-runner.md). Read only the genre requested.

For a web game, load `frontend-design` first for interface work, then return here for simulation and runtime checks. For a 3D browser game, the default minimum set is `game-design`, `3d-rendering`, `controls-and-camera`, and `testing-and-verification` plus the dependency. Add `physics-and-timing`, `browser-games`, `architecture`, or `performance` only when the task has a requirement those references answer; their links in this catalog are not a request to load them. For game trailers or captured gameplay, load `media-analysis`.

## Acceptance loop

1. Convert the request into observable checks: launch, input, movement, interaction, goal, feedback, reset, and failure or progression.
2. Make a runnable first slice with one controllable actor, a meaningful choice, a reachable objective, readable feedback, and restart. A canvas, moving counter, or isolated movement smoke test does not establish a playable loop.
3. Before expanding mechanics, capture the first playable scene from the real camera at the requested wide and narrow aspect ratios. The actor, next objective, route/hazard, ground contact, and one meaningful environmental landmark must be recognizable together. If the scene reads as a flat plane, giant occluder, or undifferentiated boxes, repair camera target/distance/pitch and large-form placement before adding content.
4. Add mechanics in dependency order: movement and collision, world interaction, goals, feedback, content, then polish.
5. Run build, syntax, and focused rule checks. In the real runtime, complete one meaningful loop with actual keyboard/pointer input; direct state mutation or simulation helpers may cover branches but cannot replace playthrough evidence. Use bounded browser flows so model latency cannot expire a timed test between actions.
6. Test frame-rate variation, resize or window changes, invalid input, restart, and missing assets or unavailable display.
7. Perform one bounded play/experience review from a new player's view: can the actor and goal be recognized from the actual rendered forms, does the camera show the next decision, and can the player understand feedback and recover? Do not use source names or passing HUD checks to excuse an ambiguous model, empty setting, or poor framing. Cite the strongest visible weakness, predict what a camera/geometry change would improve or sacrifice, then batch material repairs and renew affected checks. Report remaining quality limits separately from functional acceptance; optional polish must not start an endless review loop.

## Non-negotiables

- Controls must be discoverable, responsive, and reversible.
- Keep simulation time stable; a long frame must not create explosive physics.
- Make important state visible through HUD, audio, animation, or other feedback.
- Avoid hidden global state and unbounded entity, event, or asset growth.
- Verify 3D through world coordinates, projection, depth/occlusion, camera transforms, and spatial interaction. Canvas 2D alone neither proves nor disproves 3D; preserve explicit WebGL or engine requirements.
- If display access is unavailable, state the limitation and leave a self-test or deterministic simulation check.

## Source quality

Prefer indentation and clear HTML/CSS/JS sections. Formatting is advice; runtime correctness and explicit user requirements determine acceptance. Use an installed formatter when useful and recheck play afterward.
