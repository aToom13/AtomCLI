# Accessible frontend

## Baseline
Use semantic HTML first: `button` for actions, `a` for navigation, headings in order, landmarks, lists, labels, and native form validation. Add ARIA only when native semantics cannot express the state. Every interactive element must have an accessible name and a visible focus indicator.

## Keyboard and focus
Define a predictable tab order. Never trap focus accidentally. Dialogs move focus inside on open, return it on close, and expose an escape path. Menus support arrows only when they behave as a real composite widget. Keep focus visible against every theme and never remove the outline without a replacement.

## Visual and motion
Meet WCAG contrast targets for body text and controls; validate text over images at actual opacity. Do not encode status only through hue. Respect `prefers-reduced-motion`; remove parallax, auto advancing carousels, and large transforms while preserving state changes. Support text zoom and reflow without horizontal scrolling.

## Dynamic updates
Use concise status regions for async results, errors, saves, and navigation changes. Avoid announcing every keystroke. Error text names the field, problem, and recovery action. Preserve entered values and focus after validation. For live charts, provide a table or text summary.

## Testing
Run keyboard-only flows, screen-reader smoke tests where available, 200% zoom, forced colors, light/dark themes, touch targets, and reduced motion. Test with long labels, empty values, RTL or translated strings, and a slow connection. Check automated findings manually; a green scanner is not proof of usable accessibility.

## Anti-patterns
No click handlers on noninteractive text, no placeholder-only labels, no disabled controls that hide why an action is unavailable, no auto focus on page load without a task reason, and no `aria-hidden` on focusable descendants.

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

- MDN accessibility: https://developer.mozilla.org/en-US/docs/Learn/Accessibility
- WAI-ARIA Authoring Practices: https://www.w3.org/WAI/ARIA/apg/
