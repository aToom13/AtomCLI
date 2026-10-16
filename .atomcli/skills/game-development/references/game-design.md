# Game design and game feel

## Start with the verb
Name the repeated player verb, its risk, reward, and readable consequence. Define a 30-second loop before missions, lore, or content. Write a paper prototype for resources, fail state, restart cost, and progression.

## Mechanics contract
For each mechanic specify input, precondition, simulation result, feedback, interruption, cooldown, and failure recovery. Keep rules deterministic where possible. Separate skill expression from hidden randomness; expose odds and telegraph threats.

## Pacing
Use onboarding, escalation, mastery, release, and reflection beats. Give players a safe first success, then vary one axis at a time. Tune with recorded runs, not intuition alone. Accessibility options must not invalidate the intended loop.

## Scope
Cut content before cutting responsiveness. Prefer a small set of interacting systems over many isolated collectibles. Keep content data-driven only when iteration benefits from it.

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

