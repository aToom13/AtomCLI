# Audio and presentation

## Audio design
Map actions to events, not frame loops. Use buses for music, effects, voice, and UI; expose volume and mute controls. Pool short effects, stop them on scene unload, and handle autoplay restrictions on web.

## Mix and feedback
Prioritize gameplay-critical cues, duck competing layers, and avoid fatigue from repeated loops. Subtitles and visual alternatives carry important information. Keep loudness bounded and test headphones and speakers.

## Presentation
Use camera composition, lighting, particles, typography, and transitions to clarify state. Decorative effects must yield to readability and reduced motion.

## Verification
Test missing files, device change, pause/resume, rapid event bursts, localization of subtitles, mute persistence, and no-audio gameplay.

## Working method
Convert the request into observable play tests: boot, input, movement, collision, goal, feedback, reset, failure, and progression. Keep a tiny runnable slice. Add one mechanic at a time, then test it at slow, nominal, and overloaded frame rates.

## Failure checks
Record assumptions about coordinate system, units, ownership, lifetime, and save format. Exercise missing assets, invalid input, window resize, pause/resume, focus loss, and repeated restart. Leave a deterministic self-test when hardware or display access is unavailable.

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

