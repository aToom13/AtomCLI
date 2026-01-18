# AtomCLI Monorepo Developer Documentation

Welcome to the AtomCLI developer documentation. This file serves as the **central coordinator** for the entire monorepo.

## 1.0 Navigation Network

### 1.1 Libraries (libs/)
This directory contains shared code and core functionality broken down by domain.
*   **[Application Logic (app)](../libs/README.md)**: Main application business logic.
*   **[User Interface (ui)](../libs/ui/README.md)**: UI components and interaction handlers.
*   **[SDK (sdk)](../libs/sdk/README.md)**: Software Development Kits for integrations.
*   **[Utilities (util)](../libs/util/README.md)**: Shared utility functions.

### 1.2 AtomBase Agent (AtomBase/)
The core AI agent implementation (TypeScript-based).
*   **[Documentation](../AtomBase/README.md)**

### 1.3 Operations (script/)
Build, maintenance, and deployment scripts.

---

## 2.0 Security & Safety Guidelines

### 2.1 File System Access Policy
*   **Capabilities**: The agent has `write`, `read`, and `delete` access to files within the workspace.
*   **Risk Assessment**: While `files.py` contains logic to manage file operations, there is inherent risk in allowing an AI agent to modify the file system.
*   **Protocol**: Always review the *Implementation Plan* before approving massive changes.

### 2.2 Code Execution Sandbox
*   **Environment**: Commands are executed via `subprocess` in the local shell. **There is NO isolated sandbox by default** (unless configured externally).
*   **Execution Safety**: The `execution.py` module implements a "Safe Command List" and runtime permission checks.
*   **CRITICAL WARNING**: "Turbo Mode" or auto-execution features in the `config` can bypass user approval. Use with extreme caution.

---

## 3.0 State Management & Architecture

AtomCLI preserves context through a persistent memory system located in `.memory/`.

*   **Context (`context.json`)**: Stores explicit facts and user-defined variables.
*   **History (`history.json`)**: Maintains a truncated conversational history to provide continuity across sessions.
*   **Preferences (`preferences.json`)**: Auto-learns user patterns (e.g., preferred languages, brevity) over time.

For a detailed technical explanation of memory implementation, refer to **[AtomBase/tools/README.md#memory-management](../AtomBase/tools/README.md#memory-management)**.

---

## 4.0 Setup & Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/your-repo/AtomCLI.git
    ```
2.  **Install dependencies**:
    ```bash
    bun install
    ```
3.  **Build Project**:
    ```bash
    bun run build
    ```

---
*Created by the AtomCLI Documentation Agent.*
