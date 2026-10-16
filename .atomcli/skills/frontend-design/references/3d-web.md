# 3D web experiences

Use when depth, camera movement, spatial navigation, product viewing, or a 3D scene is part of the requested interaction. Choose renderer from required behavior, not aesthetic label. CSS transforms suit small layered compositions. Prefer WebGL/WebGPU or a 3D engine for meshes, depth testing, lighting, and spatial picking; software projection and depth/occlusion can target Canvas 2D. Verify spatial behavior and preserve any explicitly required renderer. If request says “3D game,” load `game-development` for simulation and controls.

## Scene contract before assets

Record coordinate system, scale/units, camera type, field of view or orthographic bounds, near/far planes, lighting, shadows, material style, interaction targets, and loading path. Put navigation and content meaning into ordinary HTML where possible; canvas scene should support it, not hide essential copy or controls. State what user can do in first 5 seconds and what change confirms input worked.

For a product viewer, define orbit/pan/zoom limits, selected part behavior, annotations, and reset view. For a storytelling site, map scroll or pointer input to discrete scene states with a readable fallback; avoid tying critical content visibility to exact animation timing. For a game, camera and controls belong to gameplay contract, not scroll decoration. Make focus and pointer lock explicit and reversible with Esc.

## Render lifecycle

Create one renderer/animation loop per mounted scene. Size drawing buffer from CSS size and bounded device-pixel ratio; resize camera projection when layout changes. Clamp or pause delta after a hidden tab to avoid giant animation jump. Load assets with visible progress or meaningful placeholder, validate paths and units, and surface failure with retry or non-3D content. On route exit, cancel frame loop and release textures, geometries, materials, render targets, workers, event listeners, and pointer lock. Repeated mount/unmount should not grow GPU memory.

Treat WebGL context loss as normal runtime possibility. Preserve enough application state to recreate resources or present a recovery control. Do not assume a successful build proves browser runtime: inspect console and network requests, interact with camera, resize, and verify scene still renders after route changes. Use native CSS/HTML for menus, captions, and form controls rather than drawing inaccessible text into canvas.

## Performance budget

Measure one reproducible scene at target viewport and hardware class. Record frame time distribution, draw calls, triangle count, GPU memory proxy such as textures/render targets, transferred asset bytes, and time to first useful view. Identify CPU versus GPU bottleneck before changing quality. Use instancing, LOD, texture compression, simpler shaders, culling, or reduced pixel ratio only where measurement shows benefit; verify visual and picking behavior afterward. Avoid adding a new 3D dependency if installed engine or native path already meets scope.

## Access and fallback

Provide keyboard-equivalent navigation for key actions, visible focus, readable HTML labels, and touch target sizes when touch is supported. Respect reduced motion for camera travel and scroll-linked animation. Essential content needs a static/HTML equivalent if WebGL is disabled, slow, or unavailable. Avoid flashing or camera movement that prevents reading. Screen reader semantics belong to DOM controls and explanatory content, not hidden canvas pixels.

## Acceptance checks

- Fresh load: useful content appears before or during asset load; a failed asset has visible recovery.
- Pointer, keyboard, touch (when promised), and focus transitions produce same intended state.
- Resize, high-DPI, low-end GPU, hidden tab, and context loss do not leave blank or distorted scene.
- Camera near/far clipping, transparent surfaces, picking, and world scale match visible affordances.
- Mount/unmount repeatedly; listener count and GPU resource estimates do not grow without bound.
- Measure performance before and after optimization using same scene and viewport.

## Sources reviewed

- Three.js manual entry: https://threejs.org/manual/#en/fundamentals
- MDN WebGL best practices: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
- WCAG animation from interactions: https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html
- Community Three.js profiling skill; failure taxonomy adapted, not copied: https://github.com/majidmanzarpour/threejs-game-skills/blob/main/skills/threejs-debug-profiler/SKILL.md
