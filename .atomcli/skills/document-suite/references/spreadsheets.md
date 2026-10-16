# Spreadsheet analysis

Inspect workbook sheets, dimensions, merged cells, formulas, hidden rows/columns, named ranges, dates, number formats, external links, and macros before editing. Distinguish displayed value from formula and cached value. For CSV, record delimiter, encoding, quote rules, header assumptions, and malformed rows.

Use a reproducible transformation with explicit column mapping. Preserve formulas and formatting when requested. Validate row counts, totals, duplicates, nulls, type coercion, timezone, and sample cells after save. Recalculate with a spreadsheet engine when formulas changed.

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

