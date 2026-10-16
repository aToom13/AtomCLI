# ROS 2 TF2, URDF, and robot state

Use this reference when transforms are missing, poses jump, sensors appear in wrong place, or URDF visuals disagree with collision behavior. Treat frame identity, transform authority, and timestamp as one contract. Confirm target ROS distribution and installed tools before running commands.

## Frame contract

For mobile robots, REP-105 distinguishes `map` (global, may jump with relocalization), `odom` (locally continuous, may drift), and `base_link` (robot body). Assign one publisher authority per edge. Typical path is `map` → `odom` → `base_link` → sensor frames; actual system may include `base_footprint` and articulated links. Use static transforms for fixed mounts and dynamic transforms for changing poses. Do not publish same edge from both URDF and a manual broadcaster.

Frame names are identities, not display labels. Keep names consistent in message `header.frame_id`, URDF links, RViz fixed frame, costmaps, and TF queries. For multiple robots, make frame IDs and topic namespaces distinct; namespace alone may not rename frame strings inside messages. Optical camera frames use ROS optical convention, so confirm axes before interpreting an image-derived pose. Record frame units and handedness from REP-103.

## Diagnose tree and time

```sh
ros2 topic list -t | grep -E '/tf(_static)?$'
ros2 run tf2_ros tf2_echo <source_frame> <target_frame>
ros2 run tf2_tools view_frames
ros2 topic echo /tf_static --once
```

If package-specific CLI syntax differs, use `ros2 run <package> <executable> --help` first. `view_frames` produces a graph snapshot; it does not prove timestamps are fresh. Distinguish three faults:

- **Disconnected tree:** no transform path. Check spelling, parent frame, remapping, static broadcaster, and startup order.
- **Extrapolation:** path exists but requested time is outside buffer. Compare sensor stamp, broadcaster stamp, `/clock`, and node `use_sim_time` values.
- **Stale transform:** latest available transform is old. Check publisher rate, clock progression, lifecycle state, and listener timeout.

Use sensor message timestamp for spatial alignment when correctness depends on when measurement occurred. Querying “latest” can hide latency or create inconsistent fusion. Put a bounded lookup timeout around normal startup gaps and surface a useful error; do not block indefinitely waiting for TF.

## URDF/Xacro validation

Check every link and joint: unique names, valid parent/child tree, joint axis and limits, origin units, collision and visual geometry, inertial mass and tensor, mesh scale, and package URI resolution. URDF describes model structure, not runtime proof that joint states arrive. `robot_state_publisher` needs matching `joint_states` for moving joints; static joints may publish once. Generated Xacro should be reproducible with recorded arguments.

```sh
ros2 run xacro xacro path/to/robot.urdf.xacro -o /tmp/robot.urdf
check_urdf /tmp/robot.urdf
ros2 topic echo /joint_states --once
```

`check_urdf` may come from a separate package; verify availability with `command -v check_urdf`. In RViz, compare visual, collision, sensor origin, and expected joint motion. A visually plausible model can still have wrong collision geometry or inertia. Test zero pose, each joint limit, and one representative combined pose.

## Acceptance checks

- Start before TF publishers; consumer waits bounded time and recovers when frames appear.
- Stop or delay dynamic broadcaster; consumer rejects stale pose instead of using it indefinitely.
- Switch simulated clock; TF and sensor stamps stay in same time domain.
- Launch two robot instances; frame IDs and broadcasters do not collide.
- Replay bag containing `/tf`, `/tf_static`, joint states, and sensors; target frame lookups succeed at original message timestamps.

## Sources

- ROS 2 TF2 tutorial: https://docs.ros.org/en/jazzy/Tutorials/Intermediate/Tf2/Introduction-To-Tf2.html
- ROS 2 URDF tutorial: https://docs.ros.org/en/jazzy/Tutorials/Intermediate/URDF/URDF-Main.html
- REP-105 mobile robot coordinate frames: https://www.ros.org/reps/rep-0105.html
- Community skill reviewed for frame/debugging failure modes; adapted, not copied: https://github.com/dbwls99706/ros2-engineering-skills/blob/main/references/tf2-urdf.md
