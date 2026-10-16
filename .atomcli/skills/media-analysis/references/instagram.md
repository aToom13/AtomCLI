# Instagram public content

## Access boundary
Analyze only public content the user is allowed to access. Do not bypass login, private accounts, anti-bot controls, download restrictions, or platform protections. A supplied local export is the safest input.

## Intake
Record post URL, visible caption, media type, duration, carousel order, and available audio/text. Public availability can change; save the URL and retrieval time in the report.

## Analysis
Use bounded frame sampling and transcript where available. Separate caption claims from observed media. Do not infer a person's identity, sensitive trait, or intent from appearance alone.

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

