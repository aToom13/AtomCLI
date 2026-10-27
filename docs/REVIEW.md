# Review V2

Review V2 provides one structured validation pipeline for optional independent agent review, isolated workflow quality checks, and remote pull or merge request review.

## Command-line review

Review a GitHub pull request without posting the result:

```sh
atomcli review --provider github --repo owner/repository --pr 123 --diff-only
```

Review a GitLab merge request:

```sh
atomcli review --provider gitlab --repo group/project --pr 123 --diff-only
```

The command prints a JSON report. Use `--output <path>` to save the same report, `--reviewers 1..4` to bound parallel review, and omit `--diff-only` only when the supplied token is authorized to post review comments.

GitHub repository names use `owner/repository`. GitLab accepts nested project paths such as `group/subgroup/project`. Pass an access token with `--token` when the remote endpoint or posting operation requires authentication. Do not store tokens in repository files or shell history.

## Verdicts and findings

The final verdict is one of:

- `passed`: all valid reviewer output found no blocking issue.
- `rejected`: at least one validated finding requires a change.
- `inconclusive`: reviewer execution or schema validation failed, or a claimed issue could not be validated safely.

Every accepted finding contains a P0 through P3 severity, confidence score, file path, line range, exact evidence, title, recommendation, and the reviewers that reported it.

## Validation model

Reviewer output is accepted only after it passes the shared Zod schema and is checked against the supplied change:

- The file must belong to the reviewed diff.
- The line range must exist in the real source or reconstructed diff content.
- The evidence must occur in the claimed range.
- The range must overlap changed lines when changed-line information is available.
- Duplicate or strongly overlapping findings are merged while preserving the strongest severity and confidence.

Large diffs are divided into bounded chunks with continuation headers. Content is not discarded because a file exceeds a line threshold.

## Advisory and required independent review

Automatic independent review is opt-in, including coordinated, multi-file, and critical work. Without a requested review obligation, the main agent may complete after tests and validation. Use `agent(action="spawn", subagent_type="reviewer", prompt="Review the changes and test results independently")` when requested or useful. One reviewer is the default; multiple reviewers require explicit tasks or configuration. The explicit `atomcli review` command remains available. Configuration stays backward compatible:

```jsonc
{
  "review": {
    "auto": false,
    "enabled": true,
    "policy": "adaptive",
    "reviewer_count": 1,
    "max_attempts": 3,
    "high_risk_patterns": [],
  },
}
```

`reviewer_count` accepts 1 through 4, default 1. Without `auto: true`, `effectivePolicy` is `advisory` and `configuredPolicy` retains the selected strategy. Disabled review or configured `off` resolves to `off`. Set `review.auto: true` to opt into automatic review; risk or file count alone never enables it. `advisory` recommends without spawning; `adaptive` and `enforced` select high-risk changes; `always` selects every edit. `off` or `enabled: false` disables policy-triggered review, not explicit reviewer agent calls. A taskflow `independent_review` item requires `review.require` authorization before any plan/blocker is written. Under advisory/off policy, adding new Atomic reviewer criteria requires the same authorization. The model proposes these obligations; the user authorizes them through the permission UI or an explicit `review.require` permission rule. General wildcard allow and YOLO do not authorize `review.require` or `review.retry`. Automatic policy obligations come from user-configured `review.auto: true`. Once authorized, the obligation remains required until independently verified. `high_risk_patterns` applies in every mode, including Companion `fast`.

Without a `review` block, no automatic reviewer runs. Skipped completion review uses durable `not_required` (equivalent to `not_requested`), never PASS; the tool result also exposes `status: "not_requested"`. The review gate and execution ledger share one policy snapshot. Policy changes during commit produce `stale_policy`, retried up to three times. Lifecycle rejections such as `not_active`, `terminal_outcome`, and `stale_fence` are never retried.

The same retry applies to every optimistic-concurrency rejection at commit time — `stale_revision`, `stale_plan_revision`, `stale_route`, `stale_content_snapshot`, and `stale_candidate`. A file edited by something other than a tracked tool call (a formatter, a watcher, a git hook, a second AtomCLI process) changes the content snapshot without advancing the revision, so the completion is re-hydrated and re-reviewed rather than failing the turn.

Advisory performs local impact assessment only: it starts no reviewer and pays no additional reviewer model-call cost. When assessment returns `review_advised`, the staged final response includes a user-visible recommendation to request `/review`. The note is part of the hashed completion payload and reaches CLI, TUI, Companion, and SDK message consumers. An authorized independent-review obligation can still require a reviewer.

Transport/runtime failures retry at most `min(3, max_attempts)` times, with abortable 2/4-second backoff. These retries preserve concrete rejection counters. Root cancellation never retries. A schema-valid `inconclusive` report without reviewer errors returns to worker repair when the rejection/step budget permits: collect missing evidence, stage a new candidate, then review again. It does not trigger blind infrastructure retry or permit success. Malformed output and infrastructure failures stay fail-closed. Exhausted repair budgets remain blocked. Once automatic retries are exhausted, completion offers a `review.retry` permission request if repair is still allowed: approval permits one additional bounded group, never a waiver or manufactured PASS. Denial, repeated failure, or an exhausted hard budget leaves completion blocked. At the step limit, no extra group is offered. Restore reviewer/provider availability and send a new message to try again; the old durable blocked decision remains immutable.

Explicit taskflow independent-review steps expose the same bounded retry approval before resolving the plan item; rejection keeps the obligation open, including under advisory defaults.

Permission responders are transport-specific:

| Entry                                       | Who answers `review.require` / `review.retry`                               | No response                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| TUI                                         | Permission panel                                                            | Server rejects after five minutes                                  |
| CLI `run` with a TTY                        | Terminal prompt                                                             | Rejects after 20 seconds                                           |
| CLI `run` without a TTY or with JSON output | No interactive prompt                                                       | Rejects immediately                                                |
| GitHub automation                           | Session rules deny both permissions                                         | No prompt; required review remains blocked after automatic retries |
| Companion                                   | Connected client resolves the permission request                            | Server rejects after five minutes, including disconnected clients  |
| SDK / HTTP                                  | Caller consumes `permission.asked`, replies through the permission endpoint | Server rejects after five minutes                                  |

Clients may preauthorize bounded retries using an explicit `review.retry` permission rule. Approval adds one group only; it cannot approve findings or waive review. Rejecting `review.require` leaves the proposed plan unchanged; it does not create an obligation. An authorized required review that cannot obtain PASS remains unresolved/blocked.

Reviewer sessions are reused serially. Required review fails closed: reviewer unavailability blocks success with `review_unavailable`; insufficient evidence remains a verification blocker after repair is exhausted. A warning payload cannot bypass the ledger requirement for PASS. Advisory policy recommends without dispatching reviewers and cannot manufacture approval. Failed checks, validated findings, unresolved tasks, uncertain effects, and root cancellation still prevent success. Limits remain 30 tool operations, 12 native steps, and 180 seconds per reviewer; permissions, isolation, fencing, shared hard budgets, and late-result rejection remain enforced. Reviewers never start reviewers for themselves.

Suggested handoff: "Yapılan değişiklikleri bağımsız bir değerlendirme için reviewer agent'a gönderebilirsin. Reviewer, kodu ve test sonuçlarını ayrı bir bakış açısıyla inceleyerek olası sorunları raporlayabilir."

A staged digest and revision reuse their decided review claim; repair stages a different candidate rather than changing an inconclusive verdict. Orchestrator task QA records a PASS for the reviewed workspace revision in the execution ledger; when the completion gate later evaluates the same revision it reuses that decision instead of spawning a second reviewer set. A previously decided claim for the same staged digest and revision is likewise reused, so retries or crash recovery cannot re-run reviewers for a verdict that is already final. A new mutation advances the revision and therefore requires a fresh decision.

## Posting behavior

GitHub posting creates a summary review and then attempts line comments for validated findings. GitLab posting creates a merge request note containing the structured summary. A rejected or inconclusive local result exits with a nonzero status.
