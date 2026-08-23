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
```

On an interactive terminal, `--execute` offers menus for provider, model, and agent unless they are passed explicitly. `--agent` defaults to `build`; `--suite` selects a named observation bucket. A positional file argument points at an alternative suite JSON.

## Execution model

With `--execute`, every case:

1. Materializes its fixture into the current Git workspace.
2. Runs the agent under a hard per-case watchdog (`timeoutMs`).
3. Is graded by an independent verifier whose sources are moved out of the worktree for the duration of the run and restored automatically, including after interruption.

Results are recorded under the selected suite bucket so repeated runs can be compared over time. Rate limits are detected and reported instead of being retried silently.

## Adding a case

Add a directory under `cases/` with the fixture and scripts, then register the case in `atomcli.json`. Case identifiers must be unique: the schema rejects duplicates because observations are keyed by identifier. Prefer cases that fail visibly when the agent cuts corners — verification should assert observable results, not implementation details.
