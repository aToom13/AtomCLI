# ROS 2 launch, parameters, and lifecycle

Use this reference when application works as one node but fails during system bringup, names change under namespaces, parameters differ by machine, or lifecycle transitions stall. Inspect existing launch conventions and target ROS distribution before editing. Python launch supports composition, substitutions, and event handlers; XML/YAML launch also exist, so preserve project format unless a needed behavior warrants changing it.

## Bringup contract

Define package/executable, node name, namespace, parameters, remappings, output destination, and shutdown behavior for each process. Keep common subsystem launch files reusable; include them from top-level bringup instead of duplicating nodes. Separate hardware, simulation, and test parameter files where values truly differ. Do not embed secrets, serial numbers tied to one workstation, or undisclosed hardware paths in source.

```sh
ros2 launch <package> <file.launch.py> --show-args
ros2 launch <package> <file.launch.py> use_sim_time:=true
ros2 node list
ros2 node info /node_name
ros2 param list /node_name
ros2 param dump /node_name
```

`--show-args` checks declared launch arguments; `ros2 param dump` checks effective runtime values. Passing a launch argument does not prove a node consumed it. Verify full node names and topics after namespace/remapping expansion. Prefer package share paths over relative paths tied to current working directory.

## Parameter design

Declare parameters with type, default, description, and range/constraint where API supports it. Validate required values at configure/startup: positive rates, nonempty frame IDs, limits ordered correctly, and path existence. Treat invalid values as an explicit startup error rather than silently replacing them. For dynamic updates, decide whether callback rejects unsafe changes, applies atomically, or requires lifecycle reconfigure; document which values cannot change while active.

YAML parameter keys must target correct fully qualified node name or an intentional wildcard. A file can parse successfully yet apply no values because its node key does not match. Check effective values after launch. Keep units in names or descriptions (`timeout_ms`, `wheel_radius_m`) and avoid mixing degrees/radians or wall/ROS time. Parameter overrides from CLI and launch files should have one documented precedence path for operators.

## Lifecycle nodes

Use managed nodes when resources need staged initialization or activation: configure acquires and validates resources, activate permits work, deactivate stops work, cleanup releases resources, and error handling contains failure. Define who requests each transition and how readiness is observed. A launched process is not necessarily an active node. Check state with `ros2 lifecycle get /node_name` and available transitions with `ros2 lifecycle list /node_name`.

Avoid fixed sleeps as readiness checks. Wait for a specific service, action server, topic sample, lifecycle state, or process event with a bounded timeout and visible failure. On partial startup, stop already-started dependents and release hardware. On Ctrl-C or process crash, make shutdown idempotent and ensure child processes terminate.

## Verification matrix

- Launch with defaults and with each documented override; compare effective parameters.
- Start two namespaced instances; confirm no node, topic, TF-frame, or parameter collision.
- Provide malformed YAML, missing config file, wrong node key, and out-of-range value; confirm clear failure.
- Remove one dependency or force one child to exit; confirm bringup reports failure and does not appear ready.
- Restart a lifecycle component; confirm dependent nodes recover or remain safely inactive.
- Ctrl-C during startup and steady state; confirm processes and hardware resources close.

Record exact launch command, ROS distribution, RMW implementation, parameter file hashes, effective node names, and exit codes when reporting failure.

## Sources

- ROS 2 large-project launch composition: https://docs.ros.org/en/jazzy/Tutorials/Intermediate/Launch/Using-ROS2-Launch-For-Large-Projects.html
- ROS 2 parameters CLI and semantics: https://docs.ros.org/en/jazzy/Tutorials/Beginner-CLI-Tools/Understanding-ROS2-Parameters/Understanding-ROS2-Parameters.html
- Community skill reviewed for launch/lifecycle failure modes; adapted, not copied: https://github.com/dbwls99706/ros2-engineering-skills/tree/main/references
