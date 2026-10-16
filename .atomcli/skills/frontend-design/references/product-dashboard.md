# Product dashboards

## Decide before drawing
Name the operator, decision, freshness requirement, and action for each metric. A dashboard is not a grid of charts. Remove metrics without a decision owner. Distinguish current value, change, target, confidence, and last updated time.

## States and interaction
Every chart has loading, no data, partial data, stale data, permission denied, and error states. Filters show scope and persist only when that is expected. Keep URLs shareable for important views. Tooltips supplement visible labels and have a keyboard equivalent.

## Density
Use a hierarchy: one primary signal, supporting trends, then detail. Preserve alignment and units. Avoid red/green-only status. Large tables need sorting, filtering, column visibility, virtualization, and a compact mobile strategy.

## Verification
Check timezone, rounding, nulls, extreme values, stale responses, export correctness, keyboard chart access, and query cancellation. Compare screenshot and trace at realistic data volume.

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

