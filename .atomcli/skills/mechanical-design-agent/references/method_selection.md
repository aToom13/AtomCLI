# Method selection — csg_core vs sdf_core vs a hand-parametrized surface

Every link in the parts list (see `decomposition_guide.md`) needs exactly
one production method chosen for it before you write its build script.
This is a per-LINK decision, not a per-MODEL decision — a single assembly
routinely mixes both (see the worked examples below).

## Decision checklist, in order

1. **Does the part have flat faces, sharp/defined edges, bolt holes, or a
   sketch-and-extrude cross-section (gear teeth, an I-beam, a bracket)?**
   → `csg_core`. Booleans (`subtract` for holes/pockets, `union` for
   bosses, `intersect` for trimmed stock) and `polygon_extrusion` /
   `polygon_revolve` (lathe parts: hubs, bushings, wheel rims) cover the
   overwhelming majority of mechanical hardware.

2. **Does the part need to visually/topologically "melt into" another
   part, or is it naturally described by a distance field (a blob, a
   droplet, a fillet radius, organic branching, a rounded-everything
   creature form)?** → `sdf_core`. Use `op_smooth_union` with a blend
   radius `k` — `k` IS the design parameter for "how much do these two
   features merge."

3. **Is it round-in-cross-section and swept around an axis (hub, rim,
   bushing, bottle-shape)?** → `csg_core.polygon_revolve`, even if it *feels*
   organic — a lathe profile is still exactly and cheaply representable as
   a CSG revolve, and you get crisp control over exact radii, which an SDF
   sampling grid will only approximate to within its voxel resolution.

4. **Does a single part need both** (e.g. a gear blank with one filleted
   edge, or a bracket with an organic-looking rounded boss)? Build the
   hard-edged part in `csg_core`, convert with `csg_core.to_trimesh`,
   optionally run an SDF pass over the combined field (sample the mesh's
   own points to build a proxy SDF, or just add the extra organic feature
   as its own SDF term added to the base part treated as a large box/hull
   SDF), mesh with `sdf_core.sdf_to_mesh`, then `csg_core.from_trimesh` if
   you need further exact booleans afterward. This round-trip is why both
   modules deal in `trimesh.Trimesh` as their common currency.

## Cost/precision tradeoffs to keep in mind

- **CSG (manifold3d) is exact.** A cylinder's radius in the output mesh is
  exactly the radius you asked for (up to the segment-count
  discretization of the circle, which you control directly). Use it
  whenever a dimension needs to be *correct*, not just close — bore
  diameters that must match a bearing, gear pitch radii that
  `physics_validate.gear_mesh_check` will check against a formula, bolt
  spacing, wall thickness for a snap-fit.

- **SDF (marching cubes) is approximate at the voxel scale.** The
  `resolution` parameter in `sdf_core.sdf_to_mesh` is the smallest feature
  size you'll faithfully reproduce — a fillet radius smaller than
  ~2×resolution will look faceted/lost. This is fine (even desirable, it's
  cheap) for organic forms where "close" is the target, and wrong for
  anything with a toleranced dimension.

- **SDF sampling cost scales with volume/resolution³.** Keep `bounds`
  tight around the actual shape and prefer a coarser `resolution` for a
  first pass, then tighten only the final export. `sdf_to_mesh` will raise
  rather than silently eat unbounded memory/time past ~12M voxels — treat
  that error as "shrink bounds or coarsen resolution," not a bug to route
  around.

## Worked examples

| Object | Method | Why |
|---|---|---|
| Chassis plate with a payload boss and mount holes | csg: `box` + `subtract` (holes) + `union` (boss) | flat faces, exact hole placement |
| Wheel hub/rim | csg: `polygon_revolve` | lathe cross-section |
| Suspension rocker/bogie arm (crisp mechanical look) | csg: `polygon_extrusion` of the arm's side-profile, or `hull` of two cylinders | straight-swept cross-section |
| Pine tree | sdf: stacked `op_smooth_union` of tapered `sd_round_cone` foliage tiers over an `sd_cylinder` trunk | organic, must taper/merge, no toleranced dimension |
| Splitting water droplet | sdf: two `sd_sphere`s combined with `op_smooth_union(..., k=t)`, sweep `t` | the entire point is the smooth-blend neck; this IS what SDF blending exists for |
| Spur gear | csg: `polygon_extrusion` of the involute/trapezoidal tooth profile, `union`-ed around the body (or booleaned per-tooth) | exact tooth geometry, `gear_mesh_check` needs exact pitch radii |
| Filleted bracket corner | csg body, then `sdf_core.op_round` pass over the boundary, remesh | crisp overall part, one organic-looking rounded feature |
