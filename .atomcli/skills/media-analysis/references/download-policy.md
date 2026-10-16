# Media download and rights policy

## Allowed
Download or inspect a local file or public resource when the user has a legitimate purpose and the platform permits access. Explain destination, size, format, and retention. Use bounded ranges and clean temporary files after completion when safe.

## Disallowed
No credential harvesting, private-content access, DRM or paywall bypass, anti-bot evasion, rate-limit circumvention, or hidden background downloads. Do not republish copyrighted media merely because it is reachable.

## Recovery
If access fails, report the exact boundary and ask for a user-provided file or permitted export. Never fabricate analysis from a thumbnail or title.

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

