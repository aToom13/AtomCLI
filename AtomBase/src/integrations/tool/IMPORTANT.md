# IMPORTANT ARCHITECTURAL NOTE FOR FUTURE AGENTS AND DEVELOPERS

## Primary Tool for Planning and Progress Tracking: `taskflow`

As of Phase 3 consolidation:
- **`TaskFlowTool` (`taskflow`) is the PRIMARY and ONLY user-facing planning & progress tracking tool** in AtomCLI.
- It unifies step planning (previously `chainupdate`) and todo item management (previously `todowrite` / `todoread`) into a single interface:
  ```ts
  taskflow({
    action: "start" | "update" | "complete" | "fail" | "clear",
    plan: [{ name: "Step 1", todos: ["Task A", "Task B"] }],
    step_id: "0",
    status: "running",
    todo_id: "0",
    todo_status: "completed"
  })
  ```

---

## Deprecated Legacy Tools & Dependencies

1. **`chainupdate.ts` (`ChainUpdateTool`):**
   - **Status:** DEPRECATED & UNREGISTERED from `ToolRegistry.all()`.
   - **Dependency Note:** Maintained internally because `taskflow` and TUI event handling (`TuiEvent.ChainStart`, `ChainAddStep`, `ChainUpdateStep`, `ChainCompleteStep`) publish TUI events that render progress bars in the client. Do NOT remove source files (`chainupdate.ts`) or TUI event listeners.

2. **`todo.ts` (`TodoWriteTool`, `TodoReadTool`):**
   - **Status:** DEPRECATED & UNREGISTERED from `ToolRegistry.all()`.
   - **Dependency Note:** Maintained for backward compatibility and internal session state tracking (`Session.todo`).

3. **`skilladd.ts` (`SkillAddTool`):**
   - **Status:** DEPRECATED & UNREGISTERED. Unified into `SkillTool` (`skill`) with `action: "load" | "add"`.

4. **Legacy Heuristic Tools (`test-gen.ts`, `docs.ts`, `refactor.ts`, `review.ts`):**
   - **Status:** DEPRECATED & UNREGISTERED from `ToolRegistry.all()`. Preserved only for potential CLI subcommand references.

---

## Developer / AI Rule
- **NEVER re-register `chainupdate`, `todowrite`, or `todoread` in `ToolRegistry.all()`.**
- **Always instruct models to use `taskflow` for any task planning, progress updating, or todo tracking.**
