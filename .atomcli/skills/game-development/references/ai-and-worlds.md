# AI and world simulation

## Model
Choose finite state machines for small predictable actors, behavior trees for authored sequences, and utility or planners when priorities vary. Keep navigation, sensing, decision, and actuation separate so each can be tested.

## Fairness
Use perception cones, reaction delays, readable telegraphs, and bounded knowledge. Avoid agents reacting to hidden player state. Seed randomness and record decisions for bug reports.

## World scale
Use spatial partitioning, activation volumes, and level-of-detail simulation. Persist only the state that matters. Cap path requests and define fallback behavior when navigation is incomplete.

## Verification
Test blocked paths, target loss, simultaneous events, save/load, crowd density, pause, and frame-rate variation. Inspect behavior at boundary distances and with missing world data.

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

