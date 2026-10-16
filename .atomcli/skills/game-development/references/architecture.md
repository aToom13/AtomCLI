# Game architecture

## Boundaries
Separate input sampling, fixed-step simulation, collision/world queries, presentation, UI, audio, persistence, and platform adapters. Define ownership for entities and resources. Prefer plain data for state and explicit systems for mutation.

## Loop
Use an accumulator or engine fixed tick. Sample input once per frame, queue edge events, advance simulation in bounded steps, then interpolate rendering. Pause simulation on hidden tabs and avoid multiple writers to the same state.

## Content and saves
Keep levels, tuning, localization, and progression data separate from code. Version save data and reject or migrate unknown versions. Seed procedural generation for bug reports.

## Concurrency
Cancel stale loads, guard callbacks after scene unload, and cap queues. Do not let async asset completion mutate destroyed entities.

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

- Godot best practices: https://docs.godotengine.org/en/stable/tutorials/best_practices/index.html
- Game Programming Patterns: https://gameprogrammingpatterns.com/
