# Gazebo model packaging reference

`gazebo_export.py` writes this exact layout — use this as the ground truth
when explaining output to a user or diagnosing why Gazebo won't load a
model.

```
<model_name>/
├── model.config          <- metadata Gazebo's model database reads
├── model.sdf              <- the actual model: links, joints, plugins
├── VALIDATION.txt          <- physics_validate.full_report output, for
│                             a human to read; NOT parsed by Gazebo
└── meshes/
    ├── <link_1>.stl
    ├── <link_2>.stl
    └── ...
```

## Using the output

- **Drop-in**: copy `<model_name>/` into `~/.gazebo/models/`, or add its
  *parent* directory to the `GAZEBO_MODEL_PATH` environment variable, then
  reference it from a world file with
  `<include><uri>model://<model_name></uri></include>`.
- **Direct launch**: `gz sim <model_name>/model.sdf` (new `gz` CLI) or
  `gazebo <model_name>/model.sdf` (classic Gazebo) opens it standalone.
- **Hand-off as one file**: `gazebo_export.zip_model(model_dir)` produces
  `<model_name>.zip` with the same internal structure — unzip it in
  `~/.gazebo/models/` on the receiving end.

## joint_type → SDF `<joint type="...">` mapping

| `kinematics.Joint.joint_type` | SDF type written | Notes |
|---|---|---|
| `fixed` | `fixed` | no `<axis>` emitted |
| `revolute` | `revolute` | `<limit>` from `.lower`/`.upper` (radians) |
| `continuous` | `revolute` | limit widened to ±π since SDF has no dedicated "continuous" type |
| `prismatic` | `prismatic` | `<limit>` from `.lower`/`.upper` (metres) |
| `gear` | `revolute` (×2) + `<plugin filename="libgazebo_gearbox.so">` | see `gazebo_export.py` module docstring for why SDF has no native gear-pair primitive |

## `<inertial>` block

Populated directly from `mesh_utils.mass_properties()` — `mass`, a
`<pose>` at the link's own center of mass, and the full symmetric inertia
tensor (`ixx`..`izz`) about that center of mass, in the link's local mesh
frame. This is why a link's mesh **must** pass `check_watertight` before
export: volume/COM/inertia are meaningless (and `mass_properties` will
raise) on an open surface.

## Common load failures and their real cause

| Symptom in Gazebo | Actual cause | Where to fix it |
|---|---|---|
| Model loads but falls through the floor / jitters wildly | A link wasn't actually watertight when exported (skip_validation was used, or repair silently failed) | re-run `mesh_utils.repair_and_verify`, do not use `skip_validation=True` |
| "link X in joint Y not found" at parse time | `Joint.parent`/`Joint.child` name doesn't match an added `Link.name` exactly (typo, or link added after the joint) | `kinematics.Assembly.add_joint` already raises `ValueError` for this at build time — fix it before export, don't let it reach Gazebo |
| Two wheels/gears visually overlap oddly during motion | joint `axis` or `origin_xyz` estimated wrong during decomposition | re-run `physics_validate.sweep_test` for that joint and adjust based on `worst_at_deg` |
| Gear teeth visibly clash or gap in the running sim | `gear_mesh_check` was skipped, or `center_distance` doesn't equal `pitch_radius_a + pitch_radius_b` | fix placement to satisfy the exact formula before export |
