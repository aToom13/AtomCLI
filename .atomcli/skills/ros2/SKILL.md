---
name: ros2
description: Build, debug, test, and operate ROS 2 systems across nodes, topics, services, actions, parameters, launch, QoS, TF2, URDF, simulation, rosbag, and hardware integration. Use for ROS 2 packages, robots, Gazebo, Nav2, MoveIt, sensors, or ROS middleware; do not use for generic C++ or Python without ROS 2 behavior.
trigger_words: [ros2, ros 2, rclcpp, rclpy, colcon, ament, ros node, ros topic, ros service, ros action, rosbag, tf2, urdf, xacro, gazebo ros, nav2, moveit, robotik, robot geliştirme]
---

# ROS 2 engineering

Treat a ROS 2 system as a distributed product: define graph contracts, QoS, timing, frames, ownership, launch, observability, and safety before adding nodes. Inspect the workspace and sourced distribution first. Keep hardware and simulation paths explicit.

## Route to references
- Workspace and package layout: [references/workspaces-and-packages.md](references/workspaces-and-packages.md)
- Nodes, interfaces, and executors: [references/nodes-topics-services.md](references/nodes-topics-services.md)
- QoS and reliability: [references/qos-and-discovery.md](references/qos-and-discovery.md)
- Launch, parameters, lifecycle: [references/launch-and-parameters.md](references/launch-and-parameters.md)
- TF2, URDF, and robot state: [references/tf2-urdf.md](references/tf2-urdf.md)
- Gazebo and simulation: [references/simulation.md](references/simulation.md)
- Navigation, manipulation, sensors: [references/robot-stacks.md](references/robot-stacks.md)
- rosbag, testing, and replay: [references/testing-and-bags.md](references/testing-and-bags.md)
- Deployment and safety: [references/deployment-and-safety.md](references/deployment-and-safety.md)

## Workflow
1. Inspect distro, OS, workspace, package manifest, overlays, and available hardware/simulator.
2. Write the graph contract: node names, topics, message types, QoS, rates, frames, parameters, lifecycle, and failure behavior.
3. Implement the smallest node or launch slice; run `ros2 topic/node/service/action` introspection.
4. Add tests and deterministic bag or simulation fixtures before hardware trials.
5. Validate build, graph, timing, TF tree, QoS compatibility, shutdown, and recovery.

## Guardrails
Never assume a ROS distribution, source environment, device path, or simulator is installed. Do not run motors, actuators, network discovery, or destructive workspace cleanup without explicit intent. Keep secrets and robot credentials out of launch files and bags.

## Related skills
- `game-development` for simulated gameplay or interactive robotics visualization.
- `systematic-debugging` for reproducible failures.
- `document-suite` for generated calibration or test reports.

## Sources used

- ROS 2 documentation: https://docs.ros.org/en/rolling/
- ROS 2 QoS concepts: https://docs.ros.org/en/rolling/Concepts/Intermediate/About-Quality-of-Service-Settings.html
- ROS 2 design articles: https://design.ros2.org/
