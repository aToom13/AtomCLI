# Game-facing web interface

Use for browser game shell, HUD, menus, game landing page with playable demo, or account/settings UI around gameplay. Load `game-development` for simulation, physics, camera, scoring, and runtime gameplay verification. Build DOM interface around game state; keep canvas focused on rendering and spatial interaction.

## Player journey

A fresh player should find Start, controls, objective, and how to pause or leave. Start action must enter playable state; loading state must reveal progress or failure. During play, show only information needed for the next decision: health/resources, score or progress, current objective, cooldown, status effects, and pause affordance. On success/failure, show why and provide restart or next action. Settings must persist according to requested scope, not merely change a label.

Define UI states from game states: idle, loading, ready, playing, paused, success, failed, disconnected, and unsupported capability when relevant. Ensure transitions are observable and reversible. A modal pause menu must actually stop or deliberately continue simulation, and say which. Restart must reset both game state and HUD feedback; avoid duplicate listeners or animation loops.

## Input and focus

Scope gameplay keyboard and pointer handlers to active game surface. Typing in settings, name field, chat, or accessibility menu must not accelerate or fire. Prevent default browser scrolling only for keys the game handles while active. Return focus to a sensible control when menu closes; show visible focus. If using pointer lock, explain entry, support Esc release, and recover after lock loss. If audio requires user gesture, start it on real action and show muted state clearly. Support touch/gamepad only when promised or useful for target platform, with discoverable mapping.

## Feedback and scoring

Important action should have immediate response and confirmed outcome: button press, jump, hit, pickup, trick landing, combo break, mission completion. Score feedback needs reason and amount, with enough display time to read. Distinguish pending action from completed action, especially when network or server authority exists. Do not use color alone for damage or success. HUD should avoid covering landing zones, targets, or navigation cues; test narrow screens and device safe areas.

## Capability and performance

A browser game should handle resize, high-DPI, hidden tab, lost pointer lock, WebGL/context loss, missing assets, and repeated route mount/unmount. Provide clear unsupported-capability message or playable fallback where scope demands it; do not claim a 2D perspective image is a working 3D game. Keep menu animation and HUD rerender cost below gameplay frame budget. Honor reduced motion for camera/UI transitions, flashing and screen shake.

## Acceptance checks

- From fresh load, start game and complete one meaningful action using controls shown on screen.
- Pause, open settings, type into a field, return to play; game input never leaks into field and focus is visible.
- Fail, restart twice, and verify score, timers, listeners, audio, and entities reset.
- Test keyboard, pointer, touch/gamepad if advertised, reduced motion, contrast, resize, zoom, and narrow viewport.
- Hide tab and return; physics does not jump forward from stale frame delta.
- Simulate asset or WebGL failure; UI gives truthful recovery or capability message.

## Sources reviewed

- Game Accessibility Guidelines: https://gameaccessibilityguidelines.com/
- MDN WebGL best practices and context handling: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
- Community Three.js game UI skill; interaction checklist adapted, not copied: https://github.com/majidmanzarpour/threejs-game-skills/blob/main/skills/threejs-game-ui-designer/SKILL.md
- Community game-design review skill, observable player decision framing; adapted, not copied: https://github.com/Yuki001/game-dev-skills/blob/main/skills/game-design-review/SKILL.md
