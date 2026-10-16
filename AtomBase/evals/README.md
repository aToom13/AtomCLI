# Agent-Quality Benchmark

This directory contains the internal benchmark suite that measures how well an agent performs realistic coding tasks. It is separate from the deterministic unit test suite: running the benchmark contacts a model provider, consumes quota, and takes minutes per case. It is never part of routine validation.

## Layout

- `atomcli.json`: the suite definition parsed by `AgentBenchmark.Suite`.
- `cases/<case-id>/`: per-case fixtures, setup scripts, and verification scripts.

Each case declares its own prompt, setup command, verification command, retry budget, tool-error tolerance, and hard timeout in milliseconds. Setup and verify scripts receive their locations through the `ATOMCLI_EVAL_SUITE_DIR` and `ATOMCLI_EVAL_VERIFY_DIR` environment variables.

## Running

From `AtomBase/`, reporting stored observations is read-only and safe:

```sh
bun run dev -- eval benchmark
```

Executing the suite against live models:

```sh
bun run dev -- eval benchmark --execute
bun run dev -- eval benchmark --execute --model provider/model
bun run dev -- eval benchmark --execute --agent plan
bun run dev -- eval benchmark --execute --routing fixed-base --model provider/base
bun run dev -- eval benchmark --execute --routing fixed-expert --model provider/base --expert-model provider/expert
bun run dev -- eval benchmark --execute --routing adaptive --model provider/base --expert-model provider/expert
```

On an interactive terminal, `--execute` offers menus for provider, model, and agent unless they are passed explicitly. `--agent` defaults to `build`; `--suite` selects a named observation bucket. A positional file argument points at an alternative suite JSON.

## Execution model

With `--execute`, every case:

1. Materializes its fixture into the current Git workspace.
2. Runs the agent under a hard per-case watchdog (`timeoutMs`).
3. Is graded by an independent verifier whose sources are moved out of the worktree for the duration of the run and restored automatically, including after interruption. A recovery manifest is written atomically before each move; cross-device copies stage complete data before removing the source; failed restore keeps the stash for retry.

Results are recorded under the selected suite bucket so repeated runs can be compared over time. Rate limits are detected and reported instead of being retried silently.

Routing comparisons reuse the same versioned suite. `fixed-base` pins the selected base model, `fixed-expert` requires and pins `--expert-model`, and `adaptive` enables the local adaptive policy for the benchmark session without changing user configuration. Benchmark token, tool, test, retry, and cost totals include every model used in the same turn; the observation's model ID names the final responder. The test-pass signal uses the last observed test command so a repaired failure does not remain terminal; hidden verifier results still determine actual case correctness. Reports include success, calls, expert episodes, known cost plus unpriced-call count, TTFT/total duration, proposals, rejections, repeated questions, and returns to the base route. Fixture-backed results measure the harness only; they are not live model-quality or entitlement evidence.

## Before/after comparison protocol

Run both revisions in separate clean Git workspaces. Record commit or source diff hash, suite name/version and fixture hashes, exact model IDs, agent, routing mode, provider settings, and run IDs. Use the same cases and hidden verifier for both revisions; alternate revision order and repeat runs to reduce time-of-day/provider-load bias. Do not run paired trials against a changing workspace or compare an old stored observation with a new live run.

Report each case's verifier pass/fail, wall duration, first-token time, input/output tokens, model and tool calls, retries, route changes, and known cost. Give median and range across repetitions, plus raw run IDs and failures. Mark unpriced calls and provider rate limits explicitly; do not turn an unknown cost into zero. Compare output quality from hidden verifiers or a separately blinded rubric, not from the agent's own completion claim. A test-suite pass only validates the harness, not a speed or model-quality improvement.

## Adding a case


Add a directory under `cases/` with the fixture and scripts, then register the case in `atomcli.json`. Case identifiers must be unique: the schema rejects duplicates because observations are keyed by identifier. Prefer cases that fail visibly when the agent cuts corners — verification should assert observable results, not implementation details.

