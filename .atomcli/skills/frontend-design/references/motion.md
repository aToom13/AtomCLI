# Motion and interaction

## Purpose
Motion explains cause and effect, preserves spatial context, and confirms completion. Define the state transition and user benefit before choosing an easing curve or duration.

## System
Use a small token set for micro (100–180ms), transition (180–320ms), and emphasis (320–600ms) motion. Keep transforms and opacity for most UI. Use spring-like motion only where physical continuity matters. One focal motion per viewport is usually enough.

## Product rules
Entrance motion must not delay task readiness. Exit motion must not block navigation. Loading indicators show progress or indeterminate activity without pretending to know completion. Toasts remain readable and are not the sole record of an important result. Respect reduced motion by removing travel and parallax, not by removing state communication.

## Failure modes
Test interrupted transitions, rapid repeated actions, route changes mid-animation, reduced motion, low-power devices, and prefers-reduced-transparency. Avoid looping decorative motion near text, focus rings, or game controls.

## Verification
Record a short interaction capture at normal and reduced motion, inspect focus during transitions, and confirm that state is correct when animation is disabled or the tab is backgrounded.

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

