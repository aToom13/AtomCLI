# Video analysis workflow

## Intake
Record source, container, codec, duration, dimensions, frame rate, audio tracks, language, and requested time range. Check file size before copying. For remote media, use an approved public URL and a temporary or explicit output directory.

## Progressive analysis
Start with metadata. Sample one frame every fixed interval or at shot boundaries; then inspect only segments relevant to the question. Generate a transcript or captions before asking visual questions that audio can answer. For long media, summarize chunks and reconcile them with a final pass.

## Findings
Every claim includes timestamp, observation, confidence, and source artifact. Distinguish visible fact, spoken text, and interpretation. Note occlusion, compression, missing audio, cuts, and uncertain identity.

## Verification
Cross-check important events with adjacent frames and transcript. Test timestamp seeking near start/end, variable frame rate, rotation metadata, subtitles, and corrupted segments. Keep intermediate artifacts named with source and time range.

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

