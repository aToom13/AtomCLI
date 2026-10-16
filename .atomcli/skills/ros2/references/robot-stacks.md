# ROS 2 navigation, manipulation, control, and sensors

Use this reference when integrating Nav2, MoveIt, ros2_control, localization, and sensor drivers. Choose only sections relevant to current robot. Preserve target distribution and existing stack versions; package APIs and controller plugins vary by release. Define each boundary with frame, units, timestamp, covariance, QoS, rate, command limits, and failure behavior.

## Navigation

Confirm REP-105 `map`/`odom`/`base_link` chain and sensor frames before tuning planners. Localization needs consistent odometry, map frame, timestamps, and covariance. Costmaps need obstacle source, marking/clearing behavior, footprint/inflation, update rate, and stale-obstacle policy. A valid path is not proof controller can execute it. Test localization reset, blocked path, disappearing obstacle, dynamic obstacle, planner timeout, and controller recovery. Keep velocity and acceleration limits within physical controller bounds.

## Manipulation

MoveIt planning depends on correct URDF/SRDF, joint limits, collision geometry, robot state, controller mapping, and transforms. Separate planning success from trajectory execution success. Confirm controller accepts joint names/order and result codes; test cancellation, rejected goals, missing joint state, obstacle changes, and emergency stop. A plan checked against stale scene data is not safe to execute.

## ros2_control

Identify hardware interfaces, controller manager, active controllers, claimed command interfaces, and state publishing. Compare joint limits in URDF, controller config, and hardware driver. Command timeout should lead to defined neutral/hold state. Do not rely on a published command alone as evidence of motion; compare controller state, joint/odom feedback, and error response. Test startup with hardware unavailable, controller activation failure, loss of feedback, and shutdown.

## Sensors and perception

Timestamp at acquisition where possible, preserve frame ID and calibration version, and measure transport/processing latency. Validate units, saturation, dropped-frame behavior, and covariance. For fused state, identify source of each observation and whether time synchronization interpolates, rejects, or extrapolates. Test sensor disconnect, stale sample, calibration mismatch, and TF gap. Keep raw and processed topics distinct so downstream consumers know which contract they receive.

## Evidence ladder

1. Inspect graph, parameters, TF, QoS, and controller/lifecycle state.
2. Reproduce in simulation or bag replay with measurable expected output.
3. Run bench test with physical actuation disabled or bounded where feasible.
4. Run supervised hardware test only after limits, stop path, and rollback are known.

Report command, result, state feedback, timestamps, logs, and remaining untested physical assumptions. Avoid claiming navigation or manipulation success from visualization alone.

## Sources

- Nav2 documentation: https://docs.nav2.org/
- MoveIt documentation: https://moveit.picknik.ai/main/index.html
- ROS 2 coordinate frame convention: https://www.ros.org/reps/rep-0105.html
- Community engineering skill reviewed for integration failure cases; adapted, not copied: https://github.com/dbwls99706/ros2-engineering-skills/tree/main/references
