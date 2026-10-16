---
name: frontend-design
description: Design and build distinctive, usable frontend interfaces with visual direction, responsive layouts, accessibility, performance, and real interaction. Use for websites, web apps, dashboards, portfolios, CVs, 3D web experiences, and game-facing interfaces.
trigger_words: [frontend design, website design, web ui, web app design, interface design, portfolio, dashboard design, landing page design, cv website, 3d website, game website, frontend, web app, arayüz tasarımı, web sitesi tasarımı, portfolyo sitesi]
---

# Frontend design

Design the interface as a product, then implement it. Establish audience, primary task, content hierarchy, visual direction, responsive behavior, interaction states, accessibility, and verification before polishing.

Use `create-design-system` for reusable token/component systems spanning several screens; this skill owns the current interface and its user flows.

## Route to references

- Shared foundations: [references/foundations.md](references/foundations.md)
- Portfolio or editorial site: [references/portfolio-editorial.md](references/portfolio-editorial.md)
- CV or resume site: [references/cv-resume.md](references/cv-resume.md)
- Product or admin dashboard: [references/product-dashboard.md](references/product-dashboard.md)
- 3D or WebGL site: [references/3d-web.md](references/3d-web.md)
- Game landing page or game UI: [references/game-interface.md](references/game-interface.md)
- Motion: [references/motion.md](references/motion.md)
- Accessibility: [references/accessibility.md](references/accessibility.md)
- Performance: [references/performance.md](references/performance.md)

For a web game, load `game-development` after this route and read only its relevant references. For document-heavy interfaces, load `Document Suite` as a companion skill.

## Build sequence

1. Inspect existing components, tokens, dependencies, content, and constraints.
2. In the existing plan, record a short product brief: audience/job, primary journey, visual direction and its rationale, shared type/spacing/control choices, relevant initial/error/success/narrow states, and one representative interaction. Reuse an established direction when improving an existing interface; no separate planning tool or document is needed.
3. Build that representative journey end to end with meaningful content, visible feedback, and recovery before extending the requested scope. Keep visual hierarchy and shared controls coherent from this first slice.
4. Test the primary journey with real pointer/keyboard input and real data in a browser when available; include invalid input, persistence when requested, visible focus, text zoom or narrow width, contrast, and reduced motion. DOM `.click()` and direct state changes are diagnostic helpers, not proof that user input works.
5. Inspect browser screenshots at desktop and narrow width for one visual/experience review against the brief: hierarchy, consistency, discoverability, feedback, and unfinished states. DOM snapshots and passing assertions establish behavior, not appearance. Identify the strongest remaining user-impact weakness from the rendered interface; if none is observed, cite the states inspected. Batch material findings into one repair pass and renew affected checks; do not repeat a clean review. Report remaining quality limitations separately from functional acceptance; do not invent visual-score completion gates.

## Quality bar

- Use real content hierarchy, not placeholder cards that hide missing behavior.
- Use CSS variables or the existing token system for repeated values.
- Prefer container queries for reusable components and media queries for page layout.
- Use distinctive typography and composition with restraint; avoid generic gradients and purposeless motion.
- Every requested control must change observable state.
- For 3D, verify coordinates, projection, depth/occlusion, camera, and spatial interaction. Canvas 2D alone does not decide dimensionality. Preserve an explicitly required WebGL or engine path; verify loading, fallback, resize, and reduced motion.
- Prefer readable single-file HTML, CSS, and JS sections. Formatting is advice unless explicitly requested; use an installed formatter when suitable, then recheck interactions.
