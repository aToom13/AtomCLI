# End-to-end workflow checklist

Follow these steps **in order** for every request. Do not skip a
verification step to save time — every one of them exists because the
failure it catches is invisible until a later, much more expensive stage
(a physics engine, or a person opening a broken Gazebo model).

```
 1. DECOMPOSE   -> references/decomposition_guide.md
 2. SPEC        -> write down the parts list + joint list as plain data
                    (a Python dict/list is enough; no need for a file
                    format) before writing generator code
 3. CHOOSE METHOD per part -> references/method_selection.md
 4. BUILD       -> one small script per part (or one script, functions per
                    part) using csg_core.py / sdf_core.py
 5. VERIFY WATERTIGHT per part -> mesh_utils.check_watertight /
                    repair_and_verify. A part that fails repair is a build
                    error to fix at the source (adjust the generator), not
                    a warning to note and carry forward.
 6. MASS PROPS  -> mesh_utils.mass_properties (needs step 5 to have passed)
 7. ASSEMBLE    -> kinematics.Assembly: add_link for every part (step 4),
                    add_joint for every joint (step 2's joint list)
 8. VALIDATE    -> physics_validate.full_report(assembly). Read the WHOLE
                    report. On any FAIL:
                      - watertight FAIL  -> back to step 4/5 for that link
                      - clearance FAIL   -> fix that link's placement
                        (origin_xyz) or shrink the offending geometry
                      - sweep FAIL       -> fix joint origin/axis, widen
                        real clearance, or the joint limits were wrong
                      - gear FAIL        -> fix center_distance or pitch
                        radii so they satisfy the exact sum formula
                    Re-run full_report after every fix. Do not proceed to
                    export on anything but OVERALL: PASS.
 9. EXPORT      -> gazebo_export.export_model(assembly, output_dir,
                    description=...). This re-verifies watertightness
                    itself and refuses to write a broken model.
10. PACKAGE     -> gazebo_export.zip_model(model_dir) if the user wants a
                    single hand-off file; otherwise the directory itself
                    IS the plug-and-play deliverable.
11. REPORT      -> show the user: the parts list, the VALIDATION.txt
                    contents (or a summary if it's long), and a render/
                    preview of the assembled result if you have a way to
                    produce one (e.g. matplotlib 3D plot of the meshes, or
                    an offscreen trimesh/pyrender snapshot if available in
                    the environment).
```

## Step 2 spec — minimum viable format

A plain Python list of dicts is sufficient; don't over-engineer a schema.
Example shape (fill in real numbers from step 1's decomposition):

```python
parts = [
    {"name": "chassis", "method": "csg", "parent": None},
    {"name": "rocker_L", "method": "csg", "parent": "chassis"},
    # ...
]
joints = [
    {"name": "rocker_L_pivot", "parent": "chassis", "child": "rocker_L",
     "type": "revolute", "origin_xyz": (0.18, 0.12, -0.02),
     "axis": (0, 1, 0), "lower_deg": -25, "upper_deg": 25},
    # ...
]
```

## Step 8 — what "PASS" actually certifies

`physics_validate.full_report` is deliberately narrow. A PASS certifies:
- every link is a closed 2-manifold (so mass/inertia and collision are
  well-defined),
- no two non-jointed links already overlap at rest,
- every movable joint can sweep its declared range without the moving
  subtree passing through a link it isn't jointed to,
- every declared gear pair's center distance matches the exact meshing
  condition.

It does **not** simulate dynamics, motor torque sufficiency, or
material stress — it's a build-time sanity net, not a substitute for
actually running the model in Gazebo. Say this plainly if a user asks
whether PASS means "the physics is correct" in a broader sense.

## Re-iteration is normal, not a failure mode

Expect to loop steps 4→8 a few times per part, especially for joint
placement. `sweep_test`'s FAIL report tells you the worst penetration
fraction and at what angle it happened — use that to adjust
`origin_xyz`/`axis`/limits directly rather than guessing blindly.
