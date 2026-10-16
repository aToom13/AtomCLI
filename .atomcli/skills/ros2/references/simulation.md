# ROS 2 simulation and digital test worlds

Use this reference for Gazebo or another simulator, ROS bridges, simulated sensors, and control behavior. Name simulator and version, physics engine, bridge, robot model, plugins, world, seed, and clock source. Keep simulation-only plugins and real hardware drivers behind distinct launch configurations so testing cannot accidentally command physical devices.

## Clock and bridge contract

`/use_sim_time` must be consistent for nodes comparing timestamps or TF. Confirm `/clock` publishes and advances; pause/reset may stop or jump ROS time. Use steady time for elapsed watchdogs that must keep running while simulation pauses. Record which topics cross simulator/ROS boundary, their direction, type mapping, QoS, rate, frame ID, and timestamp origin. A visible Gazebo model does not prove ROS sees sensor output or controllers accept commands.

```sh
ros2 topic list -t
ros2 topic hz /clock
ros2 topic hz /scan
ros2 topic info --verbose /scan
ros2 run tf2_tools view_frames
```

Replace example sensor topic with actual configured topic. Inspect bridge logs for type mismatch and disconnected endpoints. Verify robot spawn origin, model scaling, collision geometry, joint limits, inertias, friction, sensor extrinsics, and noise separately from visuals. Keep world resources addressable from installed package paths so clean checkout and CI can load them.

## Scenario matrix

- Start/stop: launch simulator and robot twice; no orphan process, duplicate entity, or stale bridge remains.
- Pause/resume: controllers do not accumulate an explosive time step, and watchdog semantics are deliberate.
- Reset/respawn: state, TF, joints, and lifecycle nodes return to expected initial condition.
- Sensor loss: disable bridge or sensor; perception and control enter defined degraded/safe state.
- Collision: compare rendered body with collision shape; test contact at representative surfaces.
- Latency/load: record real-time factor, sensor rate, dropped samples, CPU, memory, and controller error under load.
- Reproducibility: fix seed and initial pose, capture world/model versions, replay same action sequence.

Use a short bag to compare simulator outputs with expected value ranges and frame tree. Treat exact floating-point trajectories as environment-sensitive unless engine, platform, timestep, seed, and plugins are pinned. Separate deterministic logic assertions from physics tolerances. Passing simulation is evidence for software behavior under modeled conditions, not proof of physical safety.

## Sources

- Gazebo ROS 2 integration: https://gazebosim.org/docs/latest/ros2_integration/
- ROS 2 TF2 introduction: https://docs.ros.org/en/jazzy/Tutorials/Intermediate/Tf2/Introduction-To-Tf2.html
- Community engineering skill reviewed for simulation failure modes; adapted, not copied: https://github.com/dbwls99706/ros2-engineering-skills/blob/main/references/simulation.md
