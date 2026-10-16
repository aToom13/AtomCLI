# Document verification

Use layered checks: parser opens, expected text or cells exist, structural counts match, rendered pages or slides look correct, and output opens in an independent reader. For spreadsheets compare formulas and totals; for PDFs compare page geometry and links; for slides inspect contact sheets.

Report commands, tools, output paths, checks performed, and limitations. A zero exit code proves only that a tool finished, not that the document is correct.

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

