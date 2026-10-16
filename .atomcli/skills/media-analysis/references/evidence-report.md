# Evidence-backed media report

## Structure
1. Source and permission basis.
2. Method, tools, sampling, and time range.
3. Findings grouped by timestamp.
4. Confidence and limitations.
5. Artifacts and reproducibility notes.

## Claim format
`[00:12.4–00:15.8] Observation — evidence — confidence — caveat`. Use exact timestamps and link or name the artifact. Keep interpretation separate from observation.

## Quality gate
Recheck every high-impact claim against source media. State missing audio, inaccessible ranges, uncertain OCR, and any automated model limitations. Export to `Document Suite` only after the report is internally consistent.

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

