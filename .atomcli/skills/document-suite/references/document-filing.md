# Document filing and batch organization

Inventory files before renaming. Define naming fields, collision policy, date source, and dry-run output. Use content metadata or OCR only when needed. Never delete or move originals without explicit intent and a reversible plan.

After execution verify counts, hashes for unchanged files, destination permissions, and a machine-readable manifest. Handle duplicate names, unsupported formats, corrupt files, and partial failures individually.

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

