# Shooter game recipe

Use for first-person, third-person, or top-down games centered on aiming, projectiles, hits, cover, and enemy pressure. Decide viewpoint and whether combat is arcade, tactical, or survival before tuning. Read `../3d-rendering.md` for 3D, `../controls-and-camera.md` for aim feel, and `../ai-and-worlds.md` for enemies.

## First playable loop

Move, aim, fire at one visible target, receive hit feedback, survive or fail, restart. Expose ammo/energy, health, objective, and controls needed for decisions. One responsive weapon and one readable enemy are stronger evidence than many decorative weapons. Weapon audio or particles cannot substitute for observable hit state.

## Aim and hit contract

Define input-to-aim mapping, sensitivity, camera movement, reticle position, and whether weapon fire is hitscan or projectile. For hitscan, ray origin and camera/weapon alignment must be explicit; a reticle hit should not miss due to unexplained muzzle offset. For projectiles, choose speed, gravity, lifetime, collision sweep, and owner immunity. Determine fire cadence, reload/cooldown, spread, recoil, and shot authorization from simulation time rather than rendering frames. Clamp fire rate under held input; pause and focus loss must stop firing.

Damage needs health/armor rules, invulnerability windows if any, friendly-fire rule, death state, and restart. Show impact direction and target reaction. Separate visual effects from damage authority so missed effects do not duplicate hits. If online, server-authoritative hit checks and lag compensation need separate security review; do not imply local prototype code is multiplayer-safe.

## Enemies, cover, and pacing

Enemy behavior should expose detection, pursuit, attack wind-up, cooldown, loss of sight, and recovery. Use line of sight and navigation consistent with visible cover. Spawn outside immediate unavoidable damage range and cap living enemies/projectiles. Tune encounter budget from time-to-kill, incoming damage per second, ammo availability, cover access, and travel time. Random spawn seeds make impossible encounters reproducible. Difficulty should change meaningful decisions, not only enemy health.

Camera shake, flashes, and recoil must have readable limits; support reduced motion and avoid rapid flashing. Offer remappable controls or sensitivity options when scope allows. Distinguish enemy and ally silhouettes and make damage feedback available beyond color alone.

## Acceptance runs

- Fire at stationary and moving targets; one shot produces at most one damage event unless piercing is deliberate.
- Test obstacle between aim and target, close target, and edge of reticle; visual and hit result agree.
- Hold fire at different frame rates; ammo use and rate remain stable.
- Run out of ammo, reload, die, pause, lose focus, and restart; no stuck firing or invisible projectile leak.
- Spawn many enemies under fixed seed; entity count and frame time remain bounded.

## Sources reviewed

- Game Programming Patterns, state: https://gameprogrammingpatterns.com/state.html
- Game Accessibility Guidelines, input and visual options: https://gameaccessibilityguidelines.com/
- Community game-balance skill, measurable combat tuning; adapted, not copied: https://github.com/Yuki001/game-dev-skills/blob/main/skills/game-balance-analysis/SKILL.md
