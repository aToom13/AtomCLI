# Game performance

## Budget
Set frame, simulation, memory, load, and input-latency budgets per target. Measure CPU update, render, GPU, allocations, asset decode, and garbage collection separately.

## Techniques
Batch or instance repeated geometry, cull inactive entities, stream large assets, pool short-lived objects only after profiling, and lower quality progressively. Keep simulation cost bounded by entity and path-request caps.

## Stability
Clamp catch-up steps, handle background tabs, degrade gracefully on low hardware, and surface a quality setting. Watch memory after repeated scene transitions and reconnects.

## Verification
Profile cold/warm loads, busy scenes, worst-case effects, long sessions, resize, low-end devices, and thermal throttling. Compare before/after traces, not anecdotal smoothness.

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

