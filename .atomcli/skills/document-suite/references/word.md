# Word documents

Determine whether the file is DOCX, legacy DOC, or an export. Preserve headings, lists, tables, links, fields, comments, tracked changes, headers, footers, and section breaks as required. Convert through a real document engine when fidelity matters; plain text extraction loses layout semantics.

Verify by reopening and rendering representative pages. Check style consistency, table splitting, numbering, images, fonts, hyperlinks, and accessibility metadata. Keep source and output separate.

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

