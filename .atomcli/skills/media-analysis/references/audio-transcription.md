# Audio and transcription

## Workflow
Identify language, channels, sample rate, duration, and speech density. Prefer existing captions when their provenance is clear; otherwise use an available local transcription tool. Keep a timestamped raw transcript and a cleaned reading version.

## Quality
Mark speaker changes only when evidence supports them. Preserve uncertain words with markers, do not invent names, and record overlap, music, noise, and clipped audio. For important quotes, retain a short audio or time range for review.

## Output
Return summary, speaker or topic segments, action items, and confidence. Export SRT/VTT or a document only after checking timestamps and encoding. Do not send audio to an external service without user intent and disclosure.

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

