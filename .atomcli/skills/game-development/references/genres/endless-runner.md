# Endless runner game recipe

Use for games where motion, obstacle choice, survival time, and generated sequence form core loop. Decide whether player controls jump/slide, lanes, steering, or timing only. Read `../physics-and-timing.md`, `../controls-and-camera.md`, and `../performance.md` for shared implementation checks.

## First playable loop

Start, move automatically or via input, avoid one telegraphed obstacle, collect or score, fail on collision, see result, restart. The initial speed and first obstacle must give player enough time to learn controls. Show distance/score and restart affordance; avoid a decorative score that never changes.

## Reachable generation

Generate from validated segments with entry state, exit state, speed range, required action, and minimum reaction window. Check adjacent segments together: each segment can be individually possible yet impossible after previous landing or lane change. Reserve recovery space after demanding patterns. Bound obstacle density and same-lane blockage. Use a seed and segment index for every report; random failure without reproducible seed cannot be debugged.

A simple generator can select weighted patterns from an approved set. Add procedural geometry only when pattern rules cannot provide needed variety. Raise difficulty through measured speed, reaction time, obstacle combinations, and resource scarcity; do not raise every parameter at once. Ensure score multiplier or collection path does not require unavoidable damage.

## Simulation and memory

Separate world speed, player position, jump/slide state, and obstacle lifetime. Spawn ahead of camera far enough for telegraph and delete or recycle behind it. Collision test uses actual geometry and timing, not only visual overlap; test at high speed to prevent tunneling. Keep entity, particle, and audio counts bounded after long sessions. Pause/focus loss must stop simulation time so resuming does not instantly collide from a large frame delta.

## Fairness and accessibility

Camera shows upcoming decision distance. Obstacles differ by silhouette and animation, not color alone. Offer timing-friendly input buffer when appropriate, visible speed changes, and reduced motion for strong camera shake. If randomized rewards affect survival, separate skill challenge from luck and record distributions across many seeds.

## Acceptance runs

- Automated seeded runs validate minimum reaction time and reachability over many segment transitions.
- Reproduce a reported collision from seed, segment index, input trace, and speed.
- Play a short human run at start, medium, and maximum speed; all obstacle cues remain readable.
- Test jump/slide at chunk boundary, pause/resume, focus loss, resize, and repeated restart.
- Run long enough to verify no unbounded spawned entities or rising frame time.

## Sources reviewed

- Procedural Content Generation in Games, generation/validation concepts: https://www.pcgbook.com/
- Glenn Fiedler, fixed timestep: https://gafferongames.com/post/fix_your_timestep/
- Community game-design review skill, playtest evidence; adapted, not copied: https://github.com/Yuki001/game-dev-skills/blob/main/skills/game-design-review/SKILL.md
