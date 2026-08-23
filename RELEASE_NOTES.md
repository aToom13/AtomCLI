# AtomCLI v3.4.0

AtomCLI v3.4.0 introduces native operating system administration skills, an interactive benchmark evaluation suite with TUI picker support, asynchronous retrospective memory learning, improved installer resilience across platforms, and complete workspace version alignment.

## Operating System Administration Skills

- Added bundled `linux-admin` skill for service management (systemd, journald), package tooling (apt/dnf/pacman/zypper), firewall/networking, and container inspection.
- Added bundled `macos-admin` skill for Homebrew package management, launchd service control, defaults configuration, and system diagnostics.
- Added bundled `windows-admin` skill for PowerShell automation, winget management, Windows service operations, and registry inspection.

## Evaluation and Benchmark Suite

- Added an interactive terminal benchmark picker (`eval-picker.ts`) for streamlined test case selection and execution.
- Expanded benchmark test cases (`evals/cases/`) and evaluation configuration (`evals/atomcli.json`).
- Added robust benchmark test harnesses and automated regression verification (`agent-benchmark.test.ts`).

## Memory and Retrospective Learning

- Introduced background retrospective processing queue (`retrospective-queue.ts`) for non-blocking post-session memory distillation and learning.
- Refined semantic learning and session lifecycle integration to prioritize durable facts while minimizing extraneous model calls.
- Added isolated memory test harness configuration (`setup-home.ts`) to prevent fixture leakage during test execution.

## Core Session and Prompt Engineering

- Optimized prompt budgeting, synthetic reminder injection, and system instruction constraints.
- Streamlined session core endpoints and event stream handling for increased stability during long sessions.

## Installation and Platform Reliability

- Hardened `install.ps1` architecture detection for legacy Windows PowerShell 5.1 environments.
- Updated `install.sh` and `install.ps1` for consistent skill packaging and automated environment setup.
- Synced all workspace packages to version 3.4.0.
