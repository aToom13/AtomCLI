# Physics and timing

## Time
Use fixed simulation `dt` with an accumulator and a bounded catch-up count. Separate hidden-tab/pause gaps from active slow frames: reset the clock and held input after pause; do not silently clamp every active frame and slow the game. Choose and expose an overload policy when the catch-up bound is reached; do not accumulate unlimited work. Measure update cost to prevent spiral of death. Compare movement and objective timing over equal active elapsed time at nominal and low FPS, then verify pause/resume causes neither a jump nor a catch-up storm.

Anti-pattern: `update(Math.min(delta, 0.05))` on each animation callback. It drops active elapsed time whenever a callback is delayed, so a 200 ms frame advances only 50 ms. Accumulate the full active delta, run fixed steps up to the explicit catch-up bound, then apply the documented overload policy; clamp the accumulated work, not every callback's elapsed time before simulation.

## Motion
Choose units and document them. Integrate acceleration, drag, gravity, and impulses in a stable order. Normalize input vectors without making diagonals faster. Use swept tests or substeps for fast bodies.

## Collision
Define layers, masks, one-way surfaces, slopes, restitution, friction, and trigger semantics. Resolve penetration before applying response. Handle grounded state with a contact tolerance and coyote time only when it serves the design.

## Determinism
Use seeded randomness and stable iteration for replays or tests. Log inputs and state hashes around failures. Test tunneling, stacked contacts, corner cases, zero mass, and NaN propagation.

## Working method
Convert the request into observable play tests: boot, input, movement, collision, goal, feedback, reset, failure, and progression. Keep a tiny runnable slice. Add one mechanic at a time, then test it at slow, nominal, and overloaded frame rates.

## Failure checks
Record assumptions about coordinate system, units, ownership, lifetime, and save format. Exercise missing assets, invalid input, window resize, pause/resume, focus loss, and repeated restart. Leave a deterministic self-test when hardware or display access is unavailable.

## Implementation checklist

- State inputs, outputs, ownership, lifetime, and failure behavior before coding.
- Preserve source data and write derived output to an explicit path.
- Keep user-visible progress, empty, error, and recovery states.
- Prefer the smallest installed tool that satisfies fidelity and reproducibility.
- Bound work by size, duration, entity count, or retry count.

## Anti-patterns

- Do not claim success from a command exit code without reopening or exercising the result.
- Do not silently overwrite, upload, or publish user data.
- Do not hide uncertainty, missing inputs, unsupported formats, or hardware limits.
- Do not add a framework or abstraction before the existing platform path is measured.

## Review questions

- What observable result proves this route worked?
- What is the first useful fallback when a dependency or capability is missing?
- Can a later agent reproduce the result from the recorded command, inputs, and artifacts?


## Sources used

- Glenn Fiedler, Fix Your Timestep: https://gafferongames.com/post/fix_your_timestep/
- Game Programming Patterns, game loop: https://gameprogrammingpatterns.com/game-loop.html
