# Racing game recipe

Use for arcade racers, kart games, time trials, or simulation-oriented driving. Decide which handling promise user requested before tuning. Preserve platform and renderer constraints; read `../physics-and-timing.md`, `../controls-and-camera.md`, and `../ui-feedback.md` when building the vehicle and HUD.

## First playable loop

Start at line, accelerate, steer through one bend, pass checkpoints in order, complete lap, see time/result, and restart. Build one short track with visible boundaries and a finish rule before traffic, weather, or a garage. Expose throttle, brake, steering, pause, and reset controls. If reverse exists, define how checkpoints and lap progress behave while driving backward.

## Handling model

Track longitudinal speed, lateral slip, heading, steering input, traction, and contact with road separately. Arcade handling can use assists, but acceleration, friction, and steering must respond predictably. Steering sensitivity usually needs speed-dependent limits: full angular steering at top speed can make the car impossible to control. Braking and reverse should have distinct behavior; no instant direction change through zero speed. Surface type can modify traction only if player can read it visually or through feedback.

Choose collision response for walls and other cars: speed loss, bounce, spin, damage, or reset. Prevent tunneling through thin barriers at high speed with suitable collision shape and timestep/substeps. A restart must clear momentum, steering, checkpoint state, camera lag, and timers. Godot `VehicleBody3D` is an available starting point in that engine, but its documented limitations mean serious vehicle simulation may need a custom model; do not force it into unrelated C++ or browser projects.

## Track, progress, and fairness

Use ordered checkpoints or spline progress rather than finish-line contact alone; otherwise shortcuts and reverse crossings can create false laps. Define track boundary and off-track penalty. Place checkpoints where legitimate paths cross them and test wide turns, edge crossing, missed checkpoint, reverse crossing, and respawn. For time trials, record lap time from one clock and reject a lap lacking required gates. A ghost should replay recorded position/orientation with a versioned track and physics setup, not be treated as authoritative collision.

Traffic and rivals need bounded spawn distance, safe initial separation, lane intent or waypoint path, and recovery from blockage. Avoid spawning a car directly into player braking path without warning. Random incidents should use seed and visible telegraph. Tune difficulty by measured lap completion, collision count, and time gap across skill bands rather than only maximum AI speed.

## Camera, HUD, and accessibility

Chase camera must reveal next bend at speed, avoid clipping through track geometry, and settle after collision. Speed, lap, position/time, checkpoint warning, and damage belong in HUD only when they affect decisions. Provide alternate steering sensitivity or assist if requested or appropriate to audience; show when assist acts. Motion blur, camera shake, and high-frequency HUD animation should respect reduced-motion preference.

## Acceptance runs

- Complete clean lap; missing checkpoint blocks completion.
- Brake from top speed, reverse after stop, hit wall, and restart; velocity and progress behave consistently.
- Run identical input trace at different frame rates; checkpoint order and final position stay within declared tolerance.
- Spawn traffic repeatedly under fixed seed; no overlap, unbounded queue, or unavoidable immediate collision.
- Check gamepad/keyboard release, pause, resize, and loss of focus for stuck throttle.

## Sources reviewed

- Godot VehicleBody3D behavior and limitations: https://docs.godotengine.org/en/stable/classes/class_vehiclebody3d.html
- Glenn Fiedler, fixed timestep: https://gafferongames.com/post/fix_your_timestep/
- Community game-balance skill, audience and evidence framing; adapted, not copied: https://github.com/Yuki001/game-dev-skills/blob/main/skills/game-balance-analysis/SKILL.md
