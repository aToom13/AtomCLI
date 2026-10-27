# Atomic Work

Atomic Work is the acceptance-driven profile of the common workflow scheduler. The model uses `agent` for delegation and durable `plan/execute/status/verify/revise` actions; `todo` remains a visible checklist. Legacy `task`, `taskflow`, and `orchestrate` implementations remain compatibility adapters and are not advertised to the model. The native `/atomic-work` command selects the profile explicitly.

Start a durable goal from the TUI with the native command:

```text
/atomic-work Add login, a profile page, and password reset.
Keep existing sessions valid; typecheck and authentication tests must pass.
```

The parent inspects existing code, records a structured plan through the Task tool, and executes it with the existing orchestrate scheduler. A shared foundation goes before its consumers. Each task declares an agent, dependencies, exclusive file or directory ownership, required skills, and acceptance criteria. A final integration task represents the global goal and depends on every implementation task.

Atomic Work activates only through this command. Project commands and MCP prompts cannot replace it. An empty goal is rejected. Ordinary prompts keep their existing execution behavior. One unfinished Atomic Work goal is active per session; another invocation during that goal becomes a pending amendment. After acceptance, a new invocation starts another goal.

## Verification and execution

The execution ledger stores task definitions, revisions, evidence, checks, retry counts, and user-message classifications. Workflow checkpoints are projections; deleting a projection does not delete the plan.

The scheduler runs at most four independent tasks together. Overlapping ownership must be ordered by dependencies. Missing ownership serializes a wave. Projects without a real git worktree run serially; `isolation="required"` is rejected there. Git tasks use existing isolated worktrees and ownership-checked patches. Required skills use existing discovery, permissions, loading, and required-read checks.

Isolated children execute file operations in their worktree but keep their sessions in the parent directory. Activity, permission replies, cancellation and history remain accessible from the parent after the temporary worktree is removed. Public session access still enforces the requested directory.

Worker completion records `submitted`. Acceptance requires evidence for every criterion:

Automatic commands run in the parent project directory (the directory where this session runs). Ownership paths are relative to the git worktree root, or the session directory when git is unavailable.

| Verification | Evidence producer                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `automatic`  | Harness executes the exact declared command and records its exit code and output.                                            |
| `reviewer`   | Independent reviewer supplies a result and concrete evidence for each criterion; ledger records the actual reviewer session. |
| `parent`     | Parent explicitly verifies the criterion with evidence through `agent(action="verify")`.                                     |

A generic reviewer PASS does not satisfy all criteria. Successful parent/reviewer checks require current runtime evidence: an actual successful test run, or browser interaction followed by assertion/evaluation. Evidence must match the verifier's stored tool arguments and raw output; `observed` must quote that output. Source searches, screenshots, builds, and no-op commands alone cannot prove behavior. Reviewer/parent criteria cannot declare `command`; use automatic commands for structural checks. Parent-supplied automatic or reviewer checks are rejected.

Failed verification history treats Bun test's `--reporter=dots` and `--reporter=verbose` (also separate-value syntax) as presentation-only equivalents. Failures clear only after the same check passes in the same working directory; focused tests, changed targets/options, and other directories do not retire a whole-suite failure.

The harness adds reserved `atomic-global-*` criteria containing the full integration goal, independently of planner checks. By default these require parent runtime evidence, not a reviewer. Explicit automatic review opt-in assigns them to a reviewer; explicitly supplied reviewer criteria also remain enforced. Weak automatic checks cannot replace global acceptance. Missing criteria leave the task unaccepted; failed or invalid evidence produces `needs_revision`. Dependencies unlock only after acceptance. Global completion requires every implementation task and integration root accepted, with no pending amendment.

Retries use the task's existing `budget.maxRetries` setting, defaulting to two retries. Attempt counts survive restart. Exhaustion preserves failed checks and evidence; explicitly revise the task before restarting its retry budget.

## Amendments

Send a normal message during work:

```text
Add avatar upload to the profile page too.
```

The message is persisted before the next parent turn. New dispatch, patch application, and completion pause until the parent classifies it as an amendment, status question, or stop request. For an amendment, the parent names affected task IDs and changes their definitions. Goal, acceptance, dependencies, ownership, agent, and skills can change; new tasks can join the DAG.

Before the first plan exists, classify an amendment without task-definition changes, then plan the extended objective. The original goal stays stored for global review. After planning, amendments require affected definitions and invalidate downstream work.

Revision requires the expected ledger version. One transaction archives old snapshots, revises affected tasks and their downstream consumers once, and preserves independent accepted work. Old child output and isolated patches cannot be applied to the new revision. An unapplied isolated result interrupted by a message can be discarded and retried without counting an ordinary worker failure. Work interrupted without isolation requires reconciliation.

## Task tool protocol

These calls are made by the parent agent after native activation:

- `agent(action="plan", tasks=[...], acceptance=[...])`: persist implementation tasks and global acceptance.
- `agent(action="execute")`: await the existing scheduler.
- `agent(action="status")`: inspect authoritative task definitions, versions, evidence, and pending messages.
- `agent(action="verify", task_id="...", checks=[...])`: supply parent evidence; harness runs automatic and reviewer verification.
- `agent(action="revise", task_id="...", expectedVersion=..., definition={...})`: change one definition. The expected version belongs to that task.
- `agent(action="revise", expectedVersion=..., tasks=[...], amendment={messageID:"...", classification:"amendment", evidence:"..."})`: apply an amendment. The top-level expected version belongs to the root; each changed existing task entry needs its own expected version.
- Use the same amendment object with `classification="status"` to acknowledge a question without changing definitions, or `classification="stop"` to cancel execution.

`tasks` entries use `id`, `prompt`, `agent`, `dependsOn`, `owns`, `skills`, `acceptance`, optional `model`, `budget.maxRetries`, and `isolation`. Acceptance entries use `id`, `description`, `verification`, and an exact `command` for automatic checks. A single-task `definition` uses ledger names `goal`, `agent`, `dependsOn`, `acceptance`, and `execution`; execution contains ownership in `owns`, `skills`, `isolation`, `category`, `model`, and `maxRetries`.

Each Task action has its own strict schema. Initial planning accepts only `action`, `tasks`, and `acceptance`; it cannot carry `definition`, `amendment`, empty `checks`, or fake task IDs. Invalid plans leave the root unplanned and can be corrected. `agent` dispatch is fixed by action: `plan/execute/verify/revise` always require native Atomic activation. During Atomic Work, `spawn/workflow/steer/revive` are rejected; `plan/execute/status/verify/revise` remain available. Untargeted `status` reads the Atomic ledger; targeted `status`, `wait`, and `cancel/abort` control existing child lifecycles. Atomic children are not advertised `agent`. Generic Task runs, independent orchestration plans, and Taskflow plans are blocked during an active Atomic Work goal. Taskflow checkpoint controls remain available when needed by execution budgeting. Automatic cross-project memory recall and user-memory context are suppressed during Atomic Work; workspace discovery remains available.

Passing parent checks additionally include `runtime={criterion, setup, action, expected, observed, evidence:[{tool:"browser"|"bash", input:"exact arguments as JSON", output:"exact raw output excerpt"}]}`. `criterion` matches the acceptance description exactly. Parent tool calls must occur after the current submission; reviewer calls must occur in the current review. Failed checks may report failure without runtime evidence. Evidence authenticity is enforced; judging whether a test adequately covers a semantic requirement still depends on the verifier.

## Recovery

Restart rebuilds the workflow from ledger definitions and task states. A task that was running is not silently redispatched. Reconcile unknown mutating work using existing execution recovery before revising and executing again.

An explicitly resumed terminal execution inherits Atomic Work tasks, pending messages, and revision history through existing resume lineage. The source execution is retained, and existing deadline, call, step, and cost limits still apply. Resume does not grant fresh budget.
