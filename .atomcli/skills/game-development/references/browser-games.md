# Browser and WebGL games

## Platform choices
Prefer Canvas 2D for bounded 2D play and WebGL/WebGPU or an engine for 3D. Judge dimensionality from coordinates, projection, depth/occlusion, camera, and spatial interaction; software 3D can target Canvas 2D. Preserve any explicit renderer requirement. Use HTML for menus and accessibility. State browser support and provide capability detection. Do not load an engine when a small native API is enough.

## Loop and lifecycle
Use `requestAnimationFrame` for presentation, fixed or semi-fixed simulation, and `visibilitychange` to pause or clamp time. Handle resize with CSS pixels and a bounded device-pixel ratio. Release listeners, audio nodes, workers, and GPU resources on unmount.

## Input and audio
Scope key listeners to the focused game, handle pointer lock loss, and gate audio behind user gesture. Support touch alternatives and safe-area insets. Download assets with progress, timeout, cancellation, and a visible fallback.

## Verification
Test Chromium and one alternate browser where relevant, throttled CPU/network, no WebGL, context loss, mobile viewport, reload during save, and offline launch.

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


## Sources used

- MDN requestAnimationFrame: https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
- MDN Page Visibility API: https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
