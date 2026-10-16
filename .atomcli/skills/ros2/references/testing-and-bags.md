# ROS 2 testing, launch checks, and bags

Use this reference when ROS 2 change affects messages, timing, launch, transforms, or hardware interaction. Match each test to failure mode: pure functions need deterministic unit tests; graph contracts need live publishers and subscribers; startup/shutdown need launch tests; sensor and control behavior need replay or simulation; physical hardware comes last.

## Test layers

| Layer | Assert | Keep deterministic by |
| --- | --- | --- |
| Unit | Geometry, conversion, limits, state transitions, serialization | Fixed inputs and simulated time; no graph or wall-clock sleep |
| Component | Node parameters, topic/service names, QoS, lifecycle transition | Temporary ROS domain, explicit timeout, process cleanup |
| Launch | Nodes start, required endpoints appear, failed child exits are visible, shutdown completes | Isolated launch fixture and bounded ready checks |
| Replay/simulation | Recorded sensor input produces expected state, TF, safety response, outputs | Fixed bag and versions, controlled playback rate and clock |
| Hardware | Drivers, latency, calibration, physical stop behavior | Supervised plan, bounded motion, logs and rollback |

For `ament_cmake`, use package's `ament_cmake_gtest`, `ament_cmake_pytest`, or launch-testing facilities as appropriate. For `ament_python`, use `pytest` through `colcon test`. Run `colcon test --packages-select <package>` and inspect `colcon test-result --verbose`; build alone does not execute tests. Use `ros2 launch` for graph tests needing several nodes. Prefer checking observed condition with deadline over fixed sleep.

## Bag capture contract

```sh
ros2 topic list -t
ros2 bag record -o run_001 /scan /odom /tf /tf_static
ros2 bag info run_001
ros2 bag play run_001 --rate 0.5
```

Record only topics needed for question. Document ROS distribution, message package versions, RMW implementation, topic list, QoS, coordinate frames, sensor calibration, and whether timestamps use wall time or simulated time. If launch uses `/use_sim_time`, verify `/clock` exists and progresses during replay; otherwise nodes can wait forever or compare incompatible clocks. Keep bag data out of source control when it contains private location, faces, audio, credentials, or large binary streams.

Playback is input source, not complete test verdict. Assert observable outputs: message counts, allowed value ranges, frame IDs, transform availability, state transitions, error handling, and clean shutdown. Replaying at slower rate can expose assumptions tied to wall time; faster rate can expose queue and processing limits. State tested rate. Bag recorded with different message definitions or QoS may fail to reproduce original system; preserve metadata and use same packages where possible.

## Timing and failure cases

- Missing dependency: launch with one required node absent; confirm error or degraded state is visible and bounded.
- Stale sensor: stop publication; confirm deadline/liveliness handling or application timeout enters safe state.
- TF gap: remove or delay transform; confirm consumers report missing frame and avoid stale pose.
- Restart: kill and relaunch publisher or lifecycle node; confirm reconnection without duplicate subscriptions or stale commands.
- Shutdown: send termination; confirm child processes, hardware interfaces, files, and bag writers close.
- Resource pressure: increase message rate and payload size; record dropped samples, queue depth, latency, CPU, and memory.

When test fails, preserve exact command, exit status, launch output, bag metadata, distro, RMW config, package versions, and smallest input that reproduces fault. Never report “works in simulation” as proof of hardware safety.

## Sources

- ROS 2 testing overview: https://docs.ros.org/en/jazzy/Tutorials/Intermediate/Testing/Testing-Main.html
- Recording and playback with rosbag2: https://docs.ros.org/en/jazzy/Tutorials/Beginner-CLI-Tools/Recording-And-Playing-Back-Data/Recording-And-Playing-Back-Data.html
- ROS 2 launch testing: https://docs.ros.org/en/jazzy/Tutorials/Intermediate/Launch/Using-ROS2-Launch-For-Large-Projects.html
- Community ROS 2 engineering skill reviewed for test layers; adapted, not copied: https://github.com/dbwls99706/ros2-engineering-skills/blob/main/references/testing.md
