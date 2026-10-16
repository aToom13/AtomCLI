# Game UI, feedback, and scoring

## Information hierarchy
HUD shows only decisions needed during play: objective, health/resources, score, cooldown, and pause affordance. Menus explain controls, accessibility, audio, graphics, save state, and quit. Keep game state and UI state separate.

## Feedback
Pair visual change with sound or text where appropriate. Telegraph damage before impact. Score formulas are inspectable and avoid rewarding exploits. Combo timers, multipliers, and landing results must be legible and persist long enough to parse.

## Accessibility
Offer subtitles, remappable controls, color-independent status, text scaling, reduced motion, aim assistance, pause-anywhere, and difficulty modifiers when genre permits. Keep focus and screen-reader labels usable in menus.

## Verification
Test localization expansion, missing fonts, high contrast, reduced motion, pause during feedback, screenshots, and save/reload of progression.

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

