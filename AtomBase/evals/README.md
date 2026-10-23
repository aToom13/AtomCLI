# Agent-Quality Benchmark

This directory contains the internal benchmark suite that measures how well an agent performs realistic coding tasks. It is separate from the deterministic unit test suite: running the benchmark contacts a model provider, consumes quota, and takes minutes per case. It is never part of routine validation.

## Layout

- `atomcli.json`: the suite definition parsed by `AgentBenchmark.Suite`.
- `cases/<case-id>/`: per-case fixtures, setup scripts, and verification scripts.

Each case declares its own prompt, setup command, verification command, retry allowance, tool-error allowance, and hard timeout in milliseconds. Setup and verify scripts receive their locations through the `ATOMCLI_EVAL_SUITE_DIR` and `ATOMCLI_EVAL_VERIFY_DIR` environment variables.

## Running

From `AtomBase/`, reporting stored observations is read-only and safe:

```sh
bun run dev -- eval benchmark
```

Executing the suite against live models, from a sanitized disposable workspace:

```sh
bun run dev -- eval benchmark --execute
bun run dev -- eval benchmark --execute --model provider/model
bun run dev -- eval benchmark --execute --agent plan
bun run dev -- eval benchmark --execute --routing fixed-base --model provider/base
bun run dev -- eval benchmark --execute --routing fixed-expert --model provider/base --expert-model provider/expert
bun run dev -- eval benchmark --execute --routing adaptive --model provider/base --expert-model provider/expert
```

On an interactive terminal, `--execute` offers menus for provider, model, and agent unless they are passed explicitly. `--agent` defaults to `build`; `--suite` selects a named observation bucket. A positional file argument points at an alternative suite JSON.

Execution prints the complete JSON report before exiting: exit 0 requires every case to pass, including its independent verifier; failed, timed-out, or unobserved cases produce exit 1. Reporting stored observations without `--execute` remains read-only and exits 0 when reporting succeeds. Automatic test observations use chronological message order, regardless of the storage stream order. Turn totals include recovery calls created before the terminal completion time, even when the terminal message was created earlier. Synthetic continuation prompts remain part of the original request; a new real user request starts a separate turn. Benchmark observations, including correction signals, remain in the report but do not update runtime model-quality history; independent verifier results determine benchmark acceptance. A terminal error is unsuccessful. Failed setup is reverted before the next case.

Benchmark execution has no tool-permission approval UI. Requests requiring an interactive approval are rejected immediately with an explanation instead of waiting for the normal five-minute approval timeout. Configure explicit permissions for the authorized workspace before execution when needed. This does not grant permissions or bypass configured denials.

If completion is withheld for a failed verification command, repair the cause and rerun that command successfully in the same working directory. Passing individual test files does not retire a failed grouped or directory run; its full scope still needs verification.

Run each verification as a separate Bash call, with `workdir` selecting its directory. A compound call's exit code cannot prove which check passed or failed; recovery lists its verification commands separately. Diagnostic commands such as `git diff --no-index` must not be appended to tests. Equivalent Bun test reporter changes preserve the test scope, while different environment assignments remain distinct. A trailing unquoted `2>&1` also preserves Bun test scope; compound recovery retains it as valid shell syntax.

Execution reports retain the case session ID after setup failure or timeout when the session was created, so failed cases can be inspected directly.

## Execution model

With `--execute`, every case:

1. Materializes its fixture into the current Git workspace.
2. Runs the agent under a hard per-case watchdog (`timeoutMs`).
3. Is graded by an independent verifier whose sources are moved out of the worktree for the duration of the run and restored automatically, including after interruption. Every `verify/` directory beneath `cases/` is hidden, including nested copies. Discovery does not follow symbolic links; recovery rejects symbolic-link ancestors in both source and stash paths. A recovery manifest is written atomically before each move; cross-device copies stage complete data before removing the source; failed restore keeps the stash for retry.

Results are recorded under the selected suite bucket so repeated runs can be compared over time. Rate limits are detected and reported instead of being retried silently.

Routing comparisons reuse the same versioned suite. `fixed-base` pins the selected base model, `fixed-expert` requires and pins `--expert-model`, and `adaptive` enables the local adaptive policy for the benchmark session without changing user configuration. Benchmark token, tool, test, retry, and cost totals include every model used in the same turn; the observation's model ID names the final responder. The test-pass signal uses the last observed test command so a repaired failure does not remain terminal; hidden verifier results still determine actual case correctness. Reports include success, calls, expert episodes, known cost plus unpriced-call count, TTFT/total duration, proposals, rejections, repeated questions, and returns to the base route. Fixture-backed results measure the harness only; they are not live model-quality or entitlement evidence.

Live execution requires a sanitized disposable Git repository: verifier paths must never have been committed there. The preflight rejects verifier-bearing history (including reflogs), alternate object databases and unreachable objects. Do not use a shared clone or a linked worktree of this repository. Copy the current source candidates, initialize a fresh repository and create its baseline while excluding every `**/verify/**` path; keep the verifier files untracked for relocation. Run that copy in a filesystem sandbox exposing only the copy, its dependencies and isolated runtime data, so original checkouts, reports and backups cannot supply answers. This is required for privacy claims; Git checks alone cannot audit other host files.

Answer-bearing regression implementations live inside the private `verify/` trees; public test entrypoints only register them. Verifiers are stashed under `~/.atomcli-eval-verifier-stash/` with mode 0700, outside automatically trusted `.atomcli` data. Interrupted legacy stashes are recovered before relocation. Native file tools reject evaluator paths and symlink aliases across parent/child sessions. Benchmark Bash calls require Linux bubblewrap, restricted process visibility and private mount masks for the stash and evaluator sandbox; these protections cannot be disabled through the normal sandbox setting or test bypass. A sandbox probe must pass before any model prompt when verifiers are present. Unsupported or unavailable isolation fails closed. These measures cover local file/tool access; they are not a general hostile-code or network sandbox guarantee.

## Suite version 5: outcome and efficiency

The shipped suite uses `grading: "outcome-v2"`. A completed successful task passes when its independent verifier passes and its required tools/tests are present. Recovered tool errors, retries, and exceeding a performance target reduce the score; they do not fail correct final work. Missing observations, incomplete/failed execution, failing required tests, and missing/failed independent verification remain failures. The hard `timeoutMs` watchdog still cancels unfinished work and fails the case; `maxDurationMs` is only a performance target.

Each passing case starts at 100 points. Existing allowances (`maxToolErrors`, `maxRetries`) are penalty-free:

- Each excess tool error costs 2 points, capped at 10 per case.
- Each excess retry costs 1 point, capped at 5 per case.
- Exceeding `maxDurationMs` costs `min(5, ceil((durationMs / maxDurationMs - 1) * 5))` points.

Total efficiency deductions cannot exceed 20 points. A verified successful result with two excess tool errors passes at 96/100. A failed or unobserved case scores 0. Report `score` is the mean across all configured cases, rounded to two decimals; it is not an acceptance threshold. `accepted` means every case passed and controls the live CLI exit code. `ready` retains its historical meaning: every case has an observation, even if some failed. Raw errors, retries, duration, tokens and the separate `observation.score` trajectory diagnostic remain visible.

Custom suites without `grading` keep `strict-v1`: threshold excesses still fail, with case scores 100/0. Opt into `outcome-v2` explicitly to use efficiency deductions; each case then requires an independent verifier. Grading policies have separate observation buckets. Version 5 changes grading only: prompts, fixtures, verifier assertions, allowances and hard timeouts are unchanged. Historical reports keep their original grades; a higher pass rate under version 5 alone is not evidence of improved model quality.

## Before/after comparison protocol

Run both revisions in separate clean Git workspaces. Record commit or source diff hash, suite name/version and fixture hashes, exact model IDs, agent, routing mode, provider settings, and run IDs. Use the same cases and hidden verifier for both revisions; alternate revision order and repeat runs to reduce time-of-day/provider-load bias. Do not run paired trials against a changing workspace or compare an old stored observation with a new live run.

Report each case's verifier pass/fail, wall duration, first-token time, input/output tokens, model and tool calls, retries, route changes, and known cost. Give median and range across repetitions, plus raw run IDs and failures. Mark unpriced calls and provider rate limits explicitly; do not turn an unknown cost into zero. Compare output quality from hidden verifiers or a separately blinded rubric, not from the agent's own completion claim. A test-suite pass only validates the harness, not a speed or model-quality improvement.

## Adding a case

Add a directory under `cases/` with the fixture and scripts, then register the case in `atomcli.json`. Case identifiers must be unique: the schema rejects duplicates because observations are keyed by identifier. Prefer cases that fail visibly when the agent cuts corners — verification should assert observable results, not implementation details.

## Suite version 3

Resume-checkpoint verification parses JSON and validates all record fields against hidden ground truth. Compact and indented JSON are equivalent. Invalid JSON, string or nested schema versions, incorrect IDs/payloads, and modifications to completed records fail. Prompts, fixtures, tool-error budgets and timeouts are unchanged. Version 2 results retain their original scores; do not report version 3 as a like-for-like quality improvement over version 2.

Evaluation counts a call routed to the `invalid` tool as a tool error even when that diagnostic tool has a completed status. Invalid arguments and unavailable tools cannot appear as zero-error execution. Existing error budgets remain unchanged.

Suite version 4 replaces coordination prose keyword grading with an explicit authoritative JSON block in `VERDICT.md`. The public prompt specifies every required field: full-log metric/value/population/sample size/nearest-rank position, accepted and rejected source paths, the rejected source's stated value/sample size and whether that claim applies to the full log. Free prose has no synonym requirement. Verification independently recomputes p99 and checks the JSON types and values; setup hashes protect both evidence files and the raw log. A prose mention of the right number cannot rescue an incorrect structured verdict. Historical version 2/3 results retain their original scores; version 4 changes one task's output contract and is not a controlled comparison with them. Tool-error/retry budgets and timeouts are unchanged.
