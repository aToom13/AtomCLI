# Game testing and verification

## Test layers
Use pure tests for rules and scoring, deterministic simulation tests for movement/collision, integration tests for save/input, and one real keyboard/pointer playthrough to a meaningful objective and restart. Helper calls or state injection can cover branches but do not prove natural playability. Keep fixtures small and seed randomness.

## Acceptance matrix
For every requested feature record setup, action, expected visible result, and reset path. Include first launch, restart, pause, focus loss, resize, missing asset, invalid save, and low frame rate.

## Evidence
Capture build output, test command, runtime screenshot or log, and known limitations. Use state hashes, replay inputs, or golden metrics for regressions. A syntax check alone is not a play test.

## Flake control
Avoid wall-clock sleeps; wait on observable state. Isolate filesystem and network. Retry only known infrastructure failures, never assertion failures.

For state-dependent movement, keep physical `key_down`, a bounded observation, and `key_up` in one browser `flow`. `wait` can observe visible text/locators; asynchronous `evaluate` can observe existing runtime telemetry. A script supplied to `wait` is not evaluated. For example, adapt this existing telemetry predicate to the actual objective:

```json
{"action":"flow","steps":[
  {"action":"key_down","key":"ArrowRight"},
  {"action":"evaluate","script":"new Promise((resolve, reject) => { const end = performance.now() + 4000; function poll() { if (window.gameState.x >= 1.9) return resolve(window.gameState); if (performance.now() >= end) return reject(new Error('Movement target not reached')); setTimeout(poll, 16); } poll(); })"},
  {"action":"key_up","key":"ArrowRight"}
]}
```

This observes movement caused by real input; it does not set player position, invoke game helpers, or dispatch synthetic keyboard events. Failed/aborted flows release keys held by their `key_down` steps. Read the actual objective coordinates and hazard behavior before choosing a path; dozens of slightly different timed moves do not improve a mistaken target. A visual-only change needs affected renderer/layout checks and a representative playthrough, rather than rediscovering every unchanged mechanic.

