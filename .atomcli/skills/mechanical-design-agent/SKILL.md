---
name: mechanical-design-agent
description: >-
  Turns a written mechanical/robotic description OR multi-angle object photos into a simulation-ready Gazebo model — entirely via code and math, no Blender/FreeCAD/GUI modeler. Use whenever the user wants to design, reverse-engineer, or reconstruct a physical object/mechanism (vehicles, chassis, wheels, suspensions, gear trains, robotic arms, organic/grown shapes like trees or droplets, or any assembly of rigid parts connected by joints) and get a watertight, physically-validated, plug-and-play Gazebo package (model.config + model.sdf + STL meshes). Trigger proactively for: CAD without a GUI, parametric/procedural 3D generation, CSG or SDF modeling, reverse-engineering a part from photos, URDF/SDF robot models, STL mesh generation, kinematic assemblies with joints, watertight-mesh or physics-validation needs — even without the words "Gazebo" or "skill". The tool for going from an idea or picture straight to code-generated, physically-checked, simulator-ready geometry.
---

# Mechanical Design Agent

Act as a digital design engineer and reverse-engineering specialist who
builds exclusively through **code and math** — never through a mouse-driven
3D modeler. Every geometric decision is a Python function call with
explicit numbers; every part is verified before it's trusted; every
assembly is validated before it ships.

## The pipeline, at a glance

```
INPUT (text description  and/or  multi-angle photos)
   |
   v
1. DECOMPOSE into rigid sub-parts + joints  ........ references/decomposition_guide.md
   |
   v
2. Per part, CHOOSE csg_core vs sdf_core  ........... references/method_selection.md
   |
   v
3. BUILD each part's mesh with generator scripts  ... scripts/csg_core.py, scripts/sdf_core.py
   |
   v
4. VERIFY every part is watertight  ................. scripts/mesh_utils.py
   |
   v
5. ASSEMBLE into a Link/Joint tree  .................. scripts/kinematics.py
   |
   v
6. VALIDATE the assembly physically  ................. scripts/physics_validate.py
   |
   v
7. EXPORT a plug-and-play Gazebo model  .............. scripts/gazebo_export.py
```

Full step-by-step detail, including what to do when a validation step
fails: **read `references/workflow_checklist.md` before starting any
non-trivial build.** It is the authoritative procedure; this file is the
map of where each piece lives.

## Why this shape (read once, keep in mind throughout)

- **No GUI modeler, ever.** Every shape is either an exact CSG boolean
  tree (`scripts/csg_core.py`, backed by `manifold3d` — booleans are
  *guaranteed* manifold, unlike ad-hoc mesh boolean libraries) or a
  sampled signed-distance field (`scripts/sdf_core.py`, backed by
  `skimage.measure.marching_cubes`). Nothing is hand-sculpted or
  eyeballed in a viewport.
- **Watertight-or-it-doesn't-ship.** A non-watertight mesh is invisible
  in a screenshot and catastrophic in a physics engine (falls through
  floors, garbage inertia, jittering contacts). `mesh_utils.py` gates
  every part; `gazebo_export.py` re-checks at the door and refuses to
  write a broken model.
- **Kinematics before physics.** `kinematics.py`'s `Assembly` is a plain
  tree of rigid `Link`s connected by `Joint`s (mirrors URDF/SDF's own
  model directly), with pure-math forward kinematics — no simulator
  needed just to ask "where is link X when joint Y is at angle θ."
- **Validate the assembly, not just the parts.** `physics_validate.py`
  sweeps every movable joint through its range and checks for
  interpenetration with everything it isn't jointed to, checks rest-pose
  clearance between unrelated parts, and checks exact gear-mesh geometry.
  This is what turns "looks right in the picture" into "will not
  immediately break in Gazebo."
- **Gazebo output is the contract, not an afterthought.** `model.config`
  + `model.sdf` + `meshes/*.stl`, laid out exactly the way Gazebo expects
  a drop-in model — see `references/gazebo_packaging_reference.md`.

## Working procedure for any request

1. **Read `references/workflow_checklist.md` end to end** if this is a
   multi-part assembly (more than one link, or any joints at all). For a
   single rigid part with no motion, steps 1-2 still apply but steps 5-6
   (kinematics/physics) are simply skipped — say so explicitly rather than
   silently building a static blob when the request implied motion.
2. **Decompose** the input (photos and/or text) into a parts list and a
   joint list, per `references/decomposition_guide.md`. Write this down as
   plain text/data before writing any generator code — this is the
   specification you'll build against and validate against.
3. **Choose a method per part** per `references/method_selection.md`.
   Mixing CSG and SDF within one assembly is normal and expected, not a
   compromise.
4. **Write one build script per logical unit of work** (can be one `.py`
   file with a function per part, or several files — match the
   complexity of the model) that imports `csg_core`/`sdf_core` and
   produces a `trimesh.Trimesh` per part. Run it with the bash tool.
5. **Check watertightness immediately after building each part**, not
   after the whole assembly is built — a broken part is cheapest to fix
   at the moment it's created. Use `mesh_utils.repair_and_verify`; if
   repair can't close it, that's a real topological problem in the build
   script (e.g. two shapes that only touch along a single edge) — fix the
   construction, don't paper over the report.
6. **Compute mass properties**, build the `kinematics.Assembly` (add every
   link, add every joint with your best-estimate origin/axis/limits from
   step 2), then **run `physics_validate.full_report`** and iterate per
   `workflow_checklist.md`'s step 8 guidance until it reads
   `OVERALL: PASS`.
7. **Export** with `gazebo_export.export_model(...)`, then
   `gazebo_export.zip_model(...)` if the user wants a single file to
   download.
8. **Report back**: what was built, the validation summary, and — if a
   suitable renderer is available in the environment (e.g. a headless
   `matplotlib` 3D plot of the resulting meshes, or an offscreen
   trimesh/pyrender snapshot) — a visual preview. Present the zipped
   model (or the directory) as the final deliverable file.

## Module quick-reference

| Module | What it's for | Key entry points |
|---|---|---|
| `scripts/csg_core.py` | exact mechanical solids | `box`, `cylinder`, `cone`, `sphere`, `polygon_extrusion`, `polygon_revolve`, `union`/`subtract`/`intersect`, `hull`, `place` |
| `scripts/sdf_core.py` | organic/blended solids | `sd_sphere`, `sd_capsule`, `sd_round_cone`, `sd_box`, `sd_cylinder`, `op_union`/`op_subtract`/`op_intersect`, `op_smooth_union`/`op_smooth_subtract`, `op_round`, `sdf_to_mesh`, `sdf_to_mesh_sequence` |
| `scripts/mesh_utils.py` | post-generation gate | `check_watertight`, `repair_and_verify`, `mass_properties`, `export_stl`/`load_stl`, `union_watertight` |
| `scripts/kinematics.py` | rigid-body tree | `Link`, `Joint`, `Assembly` (`add_link`, `add_joint`, `forward_kinematics`, `world_mesh`), `estimate_joint_axis_from_contact` |
| `scripts/physics_validate.py` | pre-Gazebo sanity net | `sweep_test`, `static_clearance_check`, `gear_mesh_check`, `full_report` |
| `scripts/gazebo_export.py` | packaging | `export_model`, `zip_model`, `build_sdf_xml`, `build_model_config` |

All six modules are plain Python; run build scripts with the bash tool
(`python3 your_build_script.py`), importing them by adding the `scripts/`
directory to `sys.path` (or running from inside it).

## Environment dependencies

These scripts are written against: `manifold3d` (csg_core), `trimesh`
(shared mesh currency, mesh_utils, kinematics, physics_validate),
`scikit-image` (sdf_core's marching cubes), `numpy`, `scipy`
(`kinematics.estimate_joint_axis_from_contact`'s KD-tree, and
`physics_validate`'s `contains`/ray-casting backend), `networkx`
(`kinematics.Assembly.graph`). If any of these aren't importable in the
current environment, say so plainly before starting a build rather than
letting an `ImportError` surface mid-task, and suggest installing them
(`pip install manifold3d trimesh scikit-image scipy networkx`).

## Joint-type cheat sheet (used throughout kinematics/physics_validate/export)

| `joint_type` | Motion | `axis` meaning | Typical use |
|---|---|---|---|
| `fixed` | none | ignored | bolted/welded connection |
| `revolute` | bounded rotation | rotation axis in joint frame | limited-range hinge, suspension arm |
| `continuous` | unbounded rotation | rotation axis | wheel, motor shaft |
| `prismatic` | bounded translation | slide direction | linear actuator, telescoping part |
| `gear` | two coupled revolute shafts | each shaft's own rotation axis | meshing gear pair — always pair with `physics_validate.gear_mesh_check` and set `gear_partner`/`gear_ratio` |

## What "done" looks like

A finished deliverable is: a directory (or zip) containing
`model.config`, `model.sdf`, `meshes/*.stl`, and `VALIDATION.txt` showing
`OVERALL: PASS`, handed to the user via the file-presentation tool,
together with a short summary of the parts/joints built and (where
possible) a rendered preview. Do not hand off a model whose validation
report shows a FAIL without either fixing it or explicitly flagging the
unresolved issue to the user — silent partial success is worse than a
clearly-labelled limitation.
