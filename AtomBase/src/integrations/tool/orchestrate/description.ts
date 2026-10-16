export const DESCRIPTION = `Multi-agent workflow orchestration tool for running complex multi-step tasks with parallel execution.

⚠️ **BLOCKING TOOL**: The execute action blocks until ALL sub-agents finish. You CANNOT do other work while execute is running. Do not say "I'll also do X while sub-agents work" — this is impossible. Plan all tasks upfront and let sub-agents handle them.

**EASY PATH (one call):**
Call \`action="run"\` with a plain-language \`request\`. The tool creates one bounded task, infers category and agent when omitted, selects a model, runs tests/checkpoints and optional QA, and returns the result. No nested task JSON is needed.

**DAG PATH (2 steps):**
1. Call with action="plan" to validate your workflow
2. Call with action="execute" and the returned workflowId to run it

**WHEN TO USE:** When a user request can be broken into multiple subtasks. Examples:
- "Analyze code, write tests, and create docs" → 3 tasks, tests+docs depend on analysis
- "Refactor module A and B, then integrate" → 2 parallel tasks + 1 dependent task

**TASK CATEGORIES:** "coding" | "documentation" | "analysis" | "general"
When smart_model_routing is enabled, each task automatically gets the best model for its category.

**SAFE PARALLEL WRITES:** Git projects run each task in a private worktree and merge after task validation; optional QA results remain separate.
\`isolation="auto"\` is the default: use Git worktrees when available, otherwise the shared workspace with ownership/permission guards. \`isolation="required"\` requires a Git worktree and non-Git plans are rejected before dispatch. Never silently downgrade a user's isolation requirement.
Use \`owns: ["src/area"]\` to enforce exclusive path boundaries. Claims are literal file/directory paths, not globs; list implementation and test files explicitly, for example \`["wordCount.ts", "wordCount.test.ts"]\`, and preserve those names in the task prompt. Paths are relative to the Git worktree, or to the active session directory for Git-free sessions such as \`/tmp\`; absolute paths must stay inside that root. Traversal and symlink escapes are rejected. Ownership does not grant permissions, and denied paths cannot be retried through another child. Overlapping ownership between unordered tasks is rejected.

**TYPED RESULTS:** Add \`outputSchema\` to a task to validate its machine-readable result. \`validationMode="strict"\`
requires a tagged result and rejects unspecified object keys; \`permissive\` also accepts bare/fenced JSON.
Downstream tasks receive validated JSON directly instead of reparsing prose.

**STEP 1 - Plan:**
\`\`\`json
{
  "action": "plan",
  "tasks": [
    { "id": "analyze", "prompt": "Analyze the codebase structure", "category": "analysis" },
    { "id": "tests", "prompt": "Write unit tests based on analysis", "category": "coding", "dependsOn": ["analyze"] },
    { "id": "docs", "prompt": "Write documentation based on analysis", "category": "documentation", "dependsOn": ["analyze"] }
  ]
}
\`\`\`
→ Returns workflowId. "analyze" runs first, then "tests" and "docs" run in parallel.

**ONE-CALL EXAMPLE:**
\`\`\`json
{ "action": "run", "request": "Inspect authentication flow, fix the token expiry bug, and run the focused tests." }
\`\`\`

**STEP 2 - Execute:**
\`\`\`json
{ "action": "execute", "workflowId": "<returned-id>" }
\`\`\`
→ Runs all tasks and BLOCKS until completion. Returns combined results from all sub-agents.
Full results are also written to \`.atomcli/runs/<workflowId>/\` on disk for review.
If interrupted (ESC), call execute again with the same workflowId to restart pending tasks.

**STEP 3 (optional) - Status:**
\`\`\`json
{ "action": "status", "workflowId": "<returned-id>" }
\`\`\`

**STEP 4 (optional) - Abort:**
\`\`\`json
{ "action": "abort", "sessionId": "<sub-agent-session-id>" }
\`\`\`
→ Or abort an entire workflow:
\`\`\`json
{ "action": "abort", "workflowId": "<returned-id>" }
\`\`\``
