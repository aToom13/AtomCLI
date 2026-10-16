# PowerPoint and slide decks

Start with audience, decision, narrative, slide count, and delivery context. Build a story spine: situation, tension, evidence, decision, next action. Each slide has one claim, a readable title, and visual evidence.

For PPTX operations inspect theme, masters, layouts, notes, charts, tables, fonts, media, and relationships. Prefer existing templates. Verify by rendering a slide contact sheet and checking overflow, contrast, animations, links, speaker notes, and print/export behavior.

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

