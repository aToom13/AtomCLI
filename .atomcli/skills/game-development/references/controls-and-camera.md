# Controls and camera

## Input map
Create an action map with keyboard, pointer, touch, and controller bindings. Distinguish held, pressed, released, and analog values. Make rebinding and dead zones data-driven. Never steal text input or global shortcuts from the shell.

## Feel
Tune acceleration, turn rate, braking, jump buffer, coyote time, aim assist, and camera lag with recorded values. Keep a reachable default scheme and show controls in context. Support invert, sensitivity, hold/toggle, and remap where relevant.

## Camera
Define target, offset, look-ahead, collision avoidance, pitch limits, smoothing, and reset behavior. Prevent clipping through walls and sudden flips. Give camera shake a reduced-motion and intensity setting.

## Verification
With actual input, hold every documented direction, then diagonals; repeat at quarter-turn and reverse camera angles. Verify movement agrees with the displayed controls and still reaches the goal. Test focus loss, pointer lock cancellation, resize, different aspect ratios, remap persistence, simultaneous inputs, and controller disconnect. Clear held input on blur/pause and editable focus transfer; test moving focus while a movement key is still held. A focused text field or another app must not move the player. Reopening or restarting must not add another listener or animation loop.

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

