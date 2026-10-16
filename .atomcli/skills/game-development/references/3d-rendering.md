# 3D rendering

## Scene contract
Document world axes, units, camera projection, near/far planes, material convention, lighting, and color space. Use depth testing and real transforms for spatial interaction. Keep gameplay collision geometry independent from decorative meshes.

Before writing the scene, state the camera target, boom distance, FOV, pitch, actor's intended screen size, next objective's screen region, and which landmark frames the route. Treat these as spatial hypotheses to check in the first started frame, not constants to defend after the image disagrees.

Reuse installed renderer primitives and matrix helpers when available. For handwritten meshes, check bounds, vertex stride, finite coordinates, index range, triangle area, and winding before replicating geometry across a world. Match mesh bounds to scale semantics: a cube spanning `[-1,1]` is two units wide; a full-dimension `box(w,h,d)` must scale it by `(w/2,h/2,d/2)`. Otherwise walls double in size, roofs and facade details embed inside them, and camera tuning compensates for broken geometry. Observable projection/camera evidence must use the transforms actually rendered, not a second approximate implementation or NaN-to-zero fallback.

Single-file/offline delivery does not itself require a handwritten renderer. When libraries are permitted, an installed engine or a locally bundled, versioned renderer can provide geometry, transforms, materials and shadows in the final HTML without runtime imports or CDN requests. Preserve licensing notices and verify the final artifact offline. Respect an explicit no-dependency constraint; choose the renderer against the requested modeling/lighting quality and implementation risk, rather than treating canvas boot as the whole job.

## Assets
Validate dimensions, pivots, normals, tangents, animation clips, texture color space, and compression. Stream large assets with cancellation and show progress. Dispose GPU resources when scenes leave memory.

## Camera and lighting
Use a clear follow target, collision-aware boom, smoothing with bounded lag, and a fallback when the target is invalid. Light for gameplay readability; avoid bloom or fog that hides hazards. Cap device pixel ratio for browser renderers.

Choose a visual language that supports the player's decisions: distinct silhouettes for actors and hazards, readable paths and depth, coherent materials, and light that reveals form. Inspect one representative playable scene in actual screenshots before expanding world content. More cubes, particles, or surrounding UI do not repair an unreadable scene.

## Scene composition and finish

Primitive geometry can be intentional low-poly art; a scattering of interchangeable blocks is an unfinished scene. Choose a place and scale, then arrange its large forms around the playable path. Use silhouettes, setbacks, rooflines and negative space to frame the next decision. Place decorative details on actual surfaces in world coordinates; windows, doors and lamps should align with their building faces rather than float or face away from the player. Keep decoration out of collision routes.

Derive attachment positions from the mesh's bounds, not guessed center offsets. For a centered box with center `cy` and height `h`, ground is `cy - h/2`, roof is `cy + h/2`; a door of height `dh` rests at `ground + dh/2`. A building centered at 1.25 with height 2.5 has ground 0, so a one-unit door center is .5, not 1.75. Keep each window's full extent below the roof. Choose the visible facade's normal and align details to its surface; use local coordinates transformed with their parent when rotation is involved.

Give actors recognizable proportions and ground contact. Distinguish paving, walls, roofs and luminous objects through coherent material values and form-revealing light. For a small offline renderer, face normals, a directional light plus ambient fill, and restrained contact-shadow geometry can be enough; use the existing engine's materials/shadows when available. Emissive color alone does not illuminate surrounding geometry. Add complexity only where the representative scene benefits.

Compose through the gameplay camera at both target widths: player, next objective, hazard and route choice should remain legible together. A desktop composition cropped at narrow aspect is not a mobile composition. Keep onboarding/HUD outside that decision area. Inspect initial and moving frames before repeating a building or prop across the scene; fix scale/alignment/framing first, then add purposeful variation.

The first rendered frame is a gate for design decisions, not a boot screenshot: dismiss the intro, start play, and inspect the actor, route and landmark without an overlay hiding them. If a near prop fills the frame, the actor becomes a dot, or the scene collapses into one wall/flat plane, change the camera boom/target or large-form layout before adding detail. Keep HUD buttons above the canvas with an explicit stacking order; the canvas must not intercept clicks intended for visible controls.

Predict the tradeoff before changing camera constants, then check the actual frame. More distance fits a wider scene but shrinks the actor; wider FOV also changes perspective distortion; higher pitch reveals routes but flattens silhouettes. Frame a purposeful subset of the town at narrow width rather than losing the entire setting or shrinking gameplay beyond readability. A facade that frames the forward view may occlude the player when orbiting: inspect quarter-turn and reverse views with the real camera transforms. Critique a specific discrepancy between intended world placement and the projected image, rather than declaring success from a screenshot's existence.

Write the review as `intent → visible result → spatial cause → repair tradeoff → recheck`. Example: “The gate should frame the next pickup; reverse view puts a wall between camera and courier because the boom crosses the facade; moving the boom outward restores actor visibility but reduces town scale; the new frame keeps both actor and route readable.” This is a reasoning aid, not a visual-score gate.

## Verification
Test missing materials, context loss, resize, low GPU, high DPI, clipping, z-fighting, and repeated scene load. Capture a representative frame and inspect silhouettes, contrast, and horizon stability.


