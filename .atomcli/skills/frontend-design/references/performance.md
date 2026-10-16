# Frontend performance

## Measure first
Define budgets for initial HTML, JavaScript, CSS, fonts, images, and interaction latency. Measure LCP, INP, CLS, TTFB, long tasks, memory, and route transition time on a representative low-end device. Record a baseline before changing architecture.

## Loading
Render useful structure early. Preload only the critical font or image. Lazy-load below-fold media and expensive widgets. Reserve image dimensions to prevent layout shift. Prefer responsive images, modern formats, and cacheable immutable assets. Avoid shipping a full chart, editor, or 3D engine to a route that does not use it.

## Runtime
Batch DOM reads and writes, avoid layout thrashing, use CSS transforms for animation, and virtualize genuinely large lists. Cancel stale fetches and event listeners. Keep animation work inside a frame budget; move heavy parsing to a worker when it blocks input. Measure memory after repeated navigation.

## Network and failure
Use abortable requests, timeouts, retry limits with backoff, and an offline or degraded state. Never retry non-idempotent writes blindly. Surface stale data age and allow refresh. Ensure a slow response cannot overwrite newer state.

## Verification
Use browser performance traces, Lighthouse or equivalent, bundle analysis, throttled CPU/network, cold and warm cache runs, resize, and 30-minute soak tests for live views. Check that performance fixes preserve accessibility and error handling.

## Anti-patterns
Do not optimize by disabling feedback, removing labels, or hiding content. Do not add a cache without an invalidation rule. Do not use memoization everywhere; prove the hot path first.

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

- web.dev Core Web Vitals: https://web.dev/articles/vitals
- MDN performance guidance: https://developer.mozilla.org/en-US/docs/Web/Performance
