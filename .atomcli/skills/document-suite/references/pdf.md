# PDF workflow

Inspect page count, metadata, text layer, rotation, forms, embedded images, and permissions. Extract text with layout preserved when possible; render pages when visual order, tables, or scans matter. For merge, split, rotate, redact, or fill operations, write to a new path and keep page mapping.

Verify fonts, hyperlinks, page labels, margins, bookmarks, form values, image resolution, and searchable text. Compare representative pages before and after. Never call a scanned PDF text-extractable without OCR evidence.

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

