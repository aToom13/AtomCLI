# ROS 2 workspaces and packages

Use this reference for clean installs, overlay conflicts, missing executables, and interface generation. Record ROS distribution, shell, sourced underlays, package manager state, and workspace root before changing build files. A successful `colcon build` in a developer's sourced shell does not prove a clean installation works.

## Inspect first

```sh
printenv ROS_DISTRO AMENT_PREFIX_PATH COLCON_PREFIX_PATH
colcon list
ros2 pkg prefix <package>
ros2 pkg executables <package>
ros2 interface show <package>/msg/<Message>
```

Underlays are sourced before overlays. Source exact overlay under test (`source install/setup.bash` for Bash) after build; a stale earlier overlay can shadow edited packages. `ros2 pkg prefix` exposes which install tree resolved. Use fresh shell when comparing underlay/overlay behavior. Keep `src/`, `build/`, `install/`, and `log/` roles separate; do not put source or credentials into generated directories.

## Package contract

`package.xml` declares build, execution, test, and interface dependencies. `CMakeLists.txt` or Python packaging files must install every executable, launch file, config file, plugin description, and message interface needed at runtime. A node running from `src/` can mask a missing install rule. Verify with `ros2 pkg executables`, `ros2 launch`, and interface introspection after sourcing only the new install tree.

Prefer package-local dependencies. For a new message/service/action, decide package ownership and version impact; rebuild dependent packages after generation. Do not manually edit generated interfaces. Keep package names and interface fields stable when other robots, bags, or deployed nodes consume them.

## Build and repair

```sh
colcon build --packages-select <package> --event-handlers console_direct+
colcon test --packages-select <package>
colcon test-result --verbose
```

Use `--packages-up-to <package>` when dependencies in same workspace also need building. Inspect `log/latest_build` and the first compiler/configure error. Do not delete all `build/` and `install/` on first failure; first check sourced overlays, missing dependency, stale generated interface, and CMake cache. Use package-specific clean or `--cmake-clean-cache` only when evidence points to cache mismatch. A fresh temporary workspace or clean CI job remains final reproducibility check.

## Failure map

- Package absent from `colcon list`: wrong workspace `src/`, ignore marker, package manifest, or directory.
- Build succeeds but `ros2 run` fails: executable registration/install rule or wrong sourced overlay.
- Launch file missing: package data install rule or wrong file name.
- Message type unavailable: interface generation/export dependency or dependent package not rebuilt.
- Works in one shell only: underlay/overlay sourcing order or shell-specific setup file.
- Tests pass locally but fail clean checkout: undeclared dependency or environment leakage.

## Sources

- ROS 2 workspace tutorial: https://docs.ros.org/en/jazzy/Tutorials/Beginner-Client-Libraries/Creating-A-Workspace/Creating-A-Workspace.html
- ROS 2 interface concepts: https://docs.ros.org/en/jazzy/Concepts/Basic/About-Interfaces.html
- Community engineering skill reviewed for build/install failure taxonomy; adapted, not copied: https://github.com/dbwls99706/ros2-engineering-skills/blob/main/references/workspace-build.md
