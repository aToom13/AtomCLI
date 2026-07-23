# Decomposition Guide — from photos/description to a parts list

This is the step that happens **before any code is written**. Skipping it
and jumping straight to a build script is the single most common way this
pipeline goes wrong (you end up modelling a fused blob instead of a
kinematic assembly). Do it explicitly, in text, before touching
`csg_core`/`sdf_core`.

## 1. Read the input like an engineer, not a renderer

If the input is multi-angle photos/renders of an object (isometric, top,
bottom, side...), extract these facts from them **in this order**:

1. **Rigid bodies.** Look for surfaces that are visually continuous and
   move together. A flat chassis plate is one rigid body even if it has a
   lip, a bolt boss, or a connector moulded into it — those are *features*
   of the link, not separate links, unless the reference shows them
   articulating independently.
2. **Repeated sub-assemblies.** Four wheels that look identical are one
   part definition instantiated four times, not four separate designs.
   Count them once, note the repeat count and the transform pattern (e.g.
   "mirrored left/right, offset ±X along the chassis").
3. **Contact/pivot points.** Anywhere two rigid bodies visually touch at a
   small interface (a pin, a bore, a hinge knuckle, a shaft end) is a
   candidate joint. Note which two bodies, and what the interface geometry
   looks like (a round pin → revolute; a slot → prismatic; a flush bolted
   flange with no visible rotation clearance → fixed).
4. **Load path / kinematic chain.** Starting from the body that would stay
   put if the object were sitting on a table (usually the chassis/frame),
   trace outward: chassis → rocker arm → bogie arm → wheel, etc. This walk
   IS the tree you'll build with `kinematics.Assembly` — the root is
   whichever link has no parent.

## 2. Worked example — rocker-bogie rover chassis (the reference photos)

Reading the two supplied isometric views (top and underside) top-down:

- **`chassis`** — the flat rectangular deck. Root link. Has a small
  raised boss (payload mount) and a connector on one edge, both features
  of this one link, not separate parts.
- **`rocker_L` / `rocker_R`** — the long diagonal arm from the chassis
  side down to a **pivot** roughly at the chassis's mid-height. This pivot
  is the rocker joint: **revolute**, axis parallel to the vehicle's
  lateral (Y) axis, so the rocker can seesaw as the ground varies underneath.
- **`bogie_L` / `bogie_R`** — the shorter secondary arm hanging off the far
  end of each rocker, itself pivoting at its midpoint (visible as the small
  circular boss between the two lower wheels in the underside view) — also
  **revolute**, same axis family. This is what makes it a *rocker-bogie*
  rather than a simple rocker: each rocker's end carries a bogie that
  itself splits into two more wheel mounts.
- **six `wheel_*`** — one at the rocker's own front pivot end and two more
  at each bogie's ends (2 rockers × (1 direct + 2 via bogie) = 6). Each
  wheel attaches to its carrying arm by a **continuous** revolute joint
  (driven, full rotation, no limit) about the wheel's own axle axis
  (perpendicular to the arm at that end).
- A **differential bar** is implied on top (visible as the small raised
  fitting at the chassis's rear edge in the top view) — in a real
  rocker-bogie this couples the two rockers' angles equal-and-opposite; if
  you can't confirm its geometry confidently from the photos, it's fine to
  model the two rockers as independent revolute joints and note the
  simplification rather than invent detail the source doesn't show.

Parts list this produces (feed straight into a Python part spec, see
`workflow_checklist.md` step 2):

| link | shape family | csg or sdf | parent | joint type | axis |
|---|---|---|---|---|---|
| chassis | box + small boss | csg | (root) | — | — |
| rocker_L/R | tapered arm | csg (or sdf capsule if photos show rounded arms) | chassis | revolute | Y |
| bogie_L/R | short tapered arm | csg | rocker_L/R | revolute | Y |
| wheel_* (×6) | cylinder/disc | csg | rocker or bogie | continuous | local X (axle) |

## 3. Questions to answer before writing any build script

For **every** joint you listed:
- What is the **parent** link and what is the **child** link? (child is
  the one that moves relative to parent, i.e. the one further from the
  root.)
- **origin_xyz**: where is the joint frame, expressed in the *parent*
  link's local coordinates? Estimate from the geometry (e.g. "the rocker
  pivot boss center, which sits at roughly the chassis's mid-height and
  20% in from the side edge").
- **axis**: a unit vector, in the joint frame. If you have both halves'
  meshes already (or can approximate them as primitives), you can also
  call `kinematics.estimate_joint_axis_from_contact(mesh_a, mesh_b)` to
  get a PCA-fit starting guess from where the two parts nearly touch —
  treat it as a *starting guess to sanity-check against the visible
  symmetry axis*, not a ground truth to accept blindly.
- **limits**: does the reference show a hard stop, or does it look like it
  spins freely (wheel) vs. sweeps a bounded arc (suspension arm against a
  chassis cutout)? Guess conservatively (e.g. ±30° for an unconfirmed
  suspension sweep) and let `physics_validate.sweep_test` tell you if
  reality (interpenetration) disagrees.

## 4. When the input is a written description instead of photos

Same procedure, just skip the "read pixels" step — parse the description
directly for: named rigid parts, verbs describing relative motion ("rotates
freely", "slides along", "pivots", "is bolted rigidly to"), and any
explicit numbers (dimensions, angles, counts). Explicit written numbers
always take precedence over an assumed default.

## 5. Common mistakes this step exists to prevent

- **Treating the whole object as one link.** If nothing can move relative
  to anything else, you don't need `kinematics.py` at all — but say so
  explicitly ("this is a single rigid part, one link, no joints") rather
  than silently building a static blob when motion was implied.
- **Skipping repeated parts' transforms.** Four wheels sharing one mesh
  definition still each need their own `Link` instance (a `kinematics.Link`
  holds one mesh + one name) and their own `Joint` with its own
  `origin_xyz` — don't try to reuse a single Link across four positions.
- **Guessing a joint type that contradicts the geometry.** A shaft passing
  fully through a bore with clearance on both sides is revolute; a shaft
  that's flush and bolted with no clearance ring visible is fixed. When in
  doubt, model it as revolute with a small range and let
  `sweep_test`/`static_clearance_check` catch it if that was wrong (a
  "fixed" part that's actually revolute will show as a false interference
  failure at rest, which is your cue to reclassify it).
