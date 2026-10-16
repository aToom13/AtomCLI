# ROS 2 deployment, operations, and physical safety

Use this reference for deployed robots, device access, remote discovery, command paths, and recovery. Source configuration, package versions, launch files, RMW configuration, and hardware wiring form one deployable unit. A simulator passing does not authorize physical actuation; confirm operating context, robot limits, stop path, and user authorization for the requested hardware action.

## Reproducible deployment

Pin ROS distribution, package versions, firmware compatibility, container image or OS baseline, and interface definitions. Build in clean workspace and install only declared artifacts. On target machine, verify effective environment (`ROS_DISTRO`, `RMW_IMPLEMENTATION`, `ROS_DOMAIN_ID`, security/discovery settings), device permissions, clock sync, and launch arguments. Keep simulation, bench, and field configs separate and label them visibly.

A service manager or container should declare restart behavior, bounded logs, graceful stop, device access, network mode, and health checks. Restarting a crashed process is not sufficient if actuator state remains unknown. Avoid broad network discovery by default on field networks; configure domain, allowlist, or DDS security according to deployment policy. Never include credentials, keys, or bag data with private surroundings in source control.

## Safety case for commands

Before real motion, identify authority: who may command, what range is allowed, how stale commands expire, and what E-stop or hardware interlock exists. Define startup neutral state, command watchdog, manual override, degraded mode, and recovery owner. Put limits at controller/hardware boundary where possible; UI or planner limits alone do not contain an unsafe command. Differentiate software stop from hardware E-stop and verify each in appropriate controlled environment.

If command times out or feedback disappears, do not blindly repeat motion. Determine actual state from independent feedback, stop command path if available, and diagnose cause. A remote agent must not assume physical stop succeeded because a message was published; seek acknowledgement and observed state. Require explicit approval only when proposed action is outside the user's existing authorization or is materially irreversible; routine read-only inspection and simulation need none.

## Fault injection and observability

- Cold boot: bringup reaches expected lifecycle states and publishes fresh feedback before accepting commands.
- Partial network loss: stale commands expire; reconnect does not replay unsafe commands.
- Clock jump: sensor/TF consumers reject inconsistent timestamps and recover.
- Sensor/controller fault: fault is visible, motion response is bounded, and safe state is observable.
- Power interruption: persistence and actuator state are known after restart.
- Operator override: manual stop takes precedence and is logged without exposing secrets.

Monitor node/lifecycle status, deadline and liveliness, input age, controller state, CPU, memory, disk, bag/log size, and latency. Alert on missing evidence, not merely process exit. Keep a rollback plan with exact image/config version and state cleanup; rehearse on bench before field rollout.

## Sources

- ROS 2 security concepts: https://docs.ros.org/en/jazzy/Tutorials/Advanced/Security/Introducing-ros2-security.html
- Community engineering skill reviewed for deployment and safety boundaries; adapted, not copied: https://github.com/dbwls99706/ros2-engineering-skills/tree/main/references
- Community robotics skill reviewed for physical-state diagnostics; adapted with explicit authorization and no blind retries: https://github.com/adityakamath/ros2-skill
