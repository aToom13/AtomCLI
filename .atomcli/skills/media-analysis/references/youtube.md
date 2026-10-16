# YouTube public content

## Access
Use a public, accessible URL. Check page metadata, captions, chapters, and availability before attempting download. Browser download or an installed CLI may be used only if present and permitted; do not bypass age gates, DRM, private videos, paywalls, rate limits, or login requirements.

## Analysis
Capture title, channel, published date, duration, captions provenance, and requested ranges. Prefer transcript plus targeted keyframes over downloading an entire high-resolution stream. Cite the URL and timestamps in the result.

## Failure
Explain unavailable captions, blocked access, region restrictions, and low confidence. Offer a user-provided local file as an alternative.

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

