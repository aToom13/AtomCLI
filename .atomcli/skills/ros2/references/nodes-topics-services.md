# ROS 2 nodes, interfaces, actions, and executors

Use this reference when designing graph boundaries or diagnosing a node that is alive but not making progress. Specify whether data is a stream, bounded request/response, or long-running cancellable goal before selecting a primitive. Preserve existing public message contracts unless change is explicitly requested.

## Select communication shape

| Primitive | Use when | Verify |
| --- | --- | --- |
| Topic | Producers stream observations or state to zero or more consumers | Type, rate, QoS, timestamp, frame, late subscriber behavior |
| Service | Request has bounded response time and no progress feedback | Timeout, unavailable server, duplicate/retried request semantics |
| Action | Work spans time and needs goal acceptance, feedback, result, or cancellation | Goal rejection, preemption/cancel, feedback cadence, terminal result |

Define message ownership, units, frame, timestamp source, validity period, expected rate, and maximum payload. Prefer standard interfaces only when their semantics match; a familiar type with wrong units or frame conventions is worse than a small explicit interface. Document topic/service/action names after namespace and remapping. Check generated types with `ros2 interface show`.

## Introspection sequence

```sh
ros2 node list
ros2 node info /node_name
ros2 topic list -t
ros2 topic info --verbose /topic_name
ros2 topic hz /topic_name
ros2 service list -t
ros2 action list -t
```

Use `ros2 topic echo` only after checking QoS and message size; its own subscriber may be incompatible or create load. A visible node is not proof callbacks are executing. Compare input rate, output rate, logs at callback entry/exit, and executor configuration.

## Executors and callback groups

A single-threaded executor runs one callback at a time. A blocking timer, service, or subscription callback can starve other callbacks, including future responses needed by the blocker. Multi-threaded execution can improve progress but introduces shared-state races. Reentrant groups allow concurrent callbacks; mutually exclusive groups serialize within the group. Choose group/executor combination from observed blocking and state-sharing behavior, then protect shared state with narrow locks or message passing. Do not switch executors blindly as a cure for every stalled node.

Keep callback work bounded. Move long operations to an action or worker with cancellation. Use explicit queue depth and backpressure for bursty inputs. Timers and watchdogs need deliberate clock source: ROS time can pause or jump in simulation; steady/monotonic time is appropriate for elapsed safety deadlines. Test executor behavior under high input rate and simultaneous requests.

## Contract failures to exercise

- Publisher absent at startup, then joins late; subscriber handles both states.
- Two publishers use same topic with different QoS or rate; consumer behavior remains defined.
- Service server disappears after request; caller times out and does not wait forever.
- Action goal is rejected, cancelled mid-flight, or accepted twice; terminal state and actuator behavior are clear.
- Node restarts while namespaced; no duplicate graph entities or stale subscriptions remain.
- Callback throws or stalls; process and dependent nodes surface failure rather than appearing healthy.

Record exact distro, message hashes or package versions, RMW, names, QoS, request payload, and observable result before changing API.

## Sources

- ROS 2 interface concepts: https://docs.ros.org/en/jazzy/Concepts/Basic/About-Interfaces.html
- ROS 2 action concepts: https://docs.ros.org/en/jazzy/Concepts/Basic/About-Actions.html
- ROS 2 executor concepts: https://docs.ros.org/en/jazzy/Concepts/Intermediate/About-Executors.html
- Community engineering skill reviewed for executor failure modes; adapted, not copied: https://github.com/dbwls99706/ros2-engineering-skills/blob/main/references/nodes-executors.md
