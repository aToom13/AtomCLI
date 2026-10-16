# Keyframes and visual evidence

## Sampling
Choose interval, shot-change, or event-based sampling based on the question. Keep a contact sheet with frame timestamps. Extract higher-resolution frames only around candidate events.

## Inspection
Check text, objects, actions, transitions, camera movement, and screen state. Record what is visible and what is ambiguous. OCR output is provisional; verify against the frame and preserve crop coordinates.

## Accessibility and artifacts
Include alt-text-like descriptions, not just labels. Record blur, overlays, compression, cropping, and frame-selection bias. Avoid storing unnecessary personal imagery.

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

