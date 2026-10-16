# Frontend foundations

## Goal
Turn a request into a usable interface with a clear audience, primary action, information hierarchy, and visual point of view. Start with content and states; styling follows the product model.

## Workflow
1. Inspect existing routes, components, tokens, fonts, assets, build scripts, and constraints. Reuse established primitives before adding new ones.
2. Write a one sentence brief: audience, job, emotional tone, and primary task. Record what is deliberately out of scope.
3. Map the happy path and every state: loading, empty, partial, error, offline, disabled, success, permission denied, destructive confirmation, and narrow viewport.
4. Build semantic HTML and real interaction first. Add design tokens for color, type scale, spacing, radii, elevation, and motion.
5. Review at desktop, mobile, keyboard-only, high zoom, reduced motion, slow network, and long-content conditions.

## Visual direction
Choose one strong anchor: editorial typography, technical utility, warm craft, playful game world, or another explicit direction. Pair one expressive element with disciplined supporting UI. Avoid default purple gradients, arbitrary glass panels, excessive rounded cards, and stock copy. Typography must establish hierarchy, not decorate it. Copy should tell users what happens after an action.

Match composition to the primary task. A returning user's saved content should not be buried by a promotional hero or a full add form. Inspect populated and long-content states at narrow width: can users reach both their content and its actions without losing context? Preserve purposeful branding; density alone does not establish quality.

## Component contract
Every component documents inputs, output events, supported states, responsive behavior, focus behavior, and ownership of async work. Keep layout decisions local with container queries when a component can appear in multiple widths. Keep page composition in media queries. Use tokens instead of repeated magic numbers.

## Verification
Check semantic landmarks, heading order, form labels, focus visibility, contrast, text zoom, overflow, hit targets, and link/button semantics. Test the primary flow with real data and a long translated string. Capture one screenshot at the target viewport and compare it against the brief: hierarchy, density, distinctive element, and unfinished states.

## Anti-patterns
Do not hide missing behavior behind decorative placeholders. Do not add animation before state transitions work. Do not create a design system for one page unless reuse is proven. Do not use color alone for meaning. Do not make a modal the only route to important content.

## Related skills
- `create-design-system` for reusable tokens and component governance.
- `webapp-testing` for browser interaction and visual regression.
- `game-development` when the interface is attached to simulation or gameplay.

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

- Anthropic frontend-design guidance: https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md
- MDN responsive design and container queries: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries
- Agents Skills Finder catalog for progressive skill patterns: https://agentskillsfinder.com/
