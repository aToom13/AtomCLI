# Document conversion

Choose source and target formats based on fidelity: semantic text, editable layout, pixel-identical rendering, or data interchange. Check installed converters and their version/help. Convert a copy with explicit output directory and no silent overwrite.

Round-trip or render the result. Compare headings, tables, formulas, images, links, page count, slide count, fonts, and metadata. Explain known lossy behavior such as PDF-to-DOCX layout changes or formula recalculation.

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

