# ROS 2 QoS and discovery

Use this reference when topics exist but samples do not arrive, data is stale, a sensor stream loses frames, or nodes fail to discover each other. Record ROS distribution and RMW implementation before changing transport settings. QoS belongs to each publisher and subscription endpoint; matching topic names and message types alone does not prove delivery.

## Diagnose before changing code

```sh
ros2 doctor --report
ros2 topic list -t
ros2 topic info --verbose /topic_name
ros2 node info /node_name
ros2 topic hz /topic_name
```

Run commands in same environment as affected process. Compare topic name after remapping and namespace expansion, message type, publisher count, subscriber count, each endpoint's QoS, and `ROS_DOMAIN_ID`. A topic shown by discovery but with zero matching samples calls for endpoint inspection; a topic absent altogether calls for graph, domain, middleware, network, and process inspection. `ros2 topic echo` uses its own subscription QoS, so failed echo alone does not prove application subscriber is broken.

## Choose endpoint contracts

| Policy | Decision to record | Failure when mismatched or misused |
| --- | --- | --- |
| History/depth | Bounded `keep last` depth for normal streams; `keep all` only with measured resource limits | Queue growth, stale backlog, dropped old samples |
| Reliability | `best effort` for loss-tolerant high-rate sensors; `reliable` where retransmission is required | Reliable subscriber cannot receive from best-effort publisher |
| Durability | `volatile` for live streams; `transient local` when late subscribers need retained samples | Transient-local subscriber cannot request old samples from volatile publisher |
| Deadline | Maximum expected gap between samples, when application handles misses | Deadline-missed event without recovery state is only a log |
| Lifespan | Maximum acceptable age of sample | Expired samples are silently dropped |
| Liveliness/lease | How endpoint presence is asserted and when loss is detected | False alarms from short leases, stale authority from long leases |

QoS uses request/offered compatibility. Best-effort subscriber can accept reliable publisher; reverse fails. Volatile subscriber can accept transient-local publisher; transient-local subscriber cannot demand retained samples from volatile publisher. Check actual policies reported by `ros2 topic info --verbose`; do not assume library default or named profile remained unchanged after wrappers and remapping. `keep all` is still bounded by middleware resource limits.

ROS 2 provides predefined profiles for common uses, including sensor data and services. Use profile as starting point, then document endpoint-specific overrides. For command or state topics, select reliability and durability according to replay semantics: replaying stale motion command to late subscriber may be unsafe even when state snapshots should persist. Services have their own request and response path; do not make service requests transient-local without concrete reason.

## Discovery isolation

1. Confirm processes use same `ROS_DOMAIN_ID`, ROS distribution, compatible message definitions, and expected RMW implementation (`echo "$RMW_IMPLEMENTATION"`).
2. Check namespace and remapping with `ros2 node info` and `ros2 topic list -t`; leading `/` changes name resolution.
3. Repeat with both nodes on one host. If that works, inspect container networking, multicast discovery, firewall rules, VPN, and DDS vendor configuration across hosts.
4. Compare behavior with one known RMW implementation at time. Record implementation and config; do not mix vendor settings in one diagnosis.
5. Restart ROS 2 daemon if CLI graph output seems stale (`ros2 daemon stop`; next CLI query starts it again). Confirm with actual subscriber delivery, not only CLI graph presence.

## Reproduce and verify

Create minimal publisher and subscriber using exact topic, message type, and endpoint QoS. Test publisher-first and subscriber-first startup. Vary packet loss or network topology only after local delivery works. For timing faults, record publication timestamps, receive timestamps, deadline/liveliness events, dropped sample counts, and action taken when data becomes stale. Test shutdown and reconnect; verify downstream control enters safe state when expected data stops.

## Sources

- ROS 2 QoS policies, profiles, and compatibility: https://docs.ros.org/en/jazzy/Concepts/Intermediate/About-Quality-of-Service-Settings.html
- ROS 2 command-line tools: https://docs.ros.org/en/jazzy/Tutorials/Beginner-CLI-Tools.html
- ROS 2 middleware selection: https://docs.ros.org/en/jazzy/Concepts/Intermediate/About-Different-Middleware-Vendors.html
- Community ROS 2 engineering skill reviewed for diagnostics coverage; adapted, not copied: https://github.com/dbwls99706/ros2-engineering-skills/tree/main/references
