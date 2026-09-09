# AtomCLI v3.4.3-debug2

AtomCLI 3.4.3-debug2 is a prerelease on top of v3.4.3-debug focused on provider catalog correctness, a new Cline OAuth provider, and unknown-work recovery in the TUI. Companion remains a beta product under active development; Android, iOS, background execution, and OEM integrations are not universally stable.

## Provider and Session Reliability

- Forwarded AtomCLI session identity to Zen-compatible endpoints so anonymous free models and verification probes pass the gateway session check.
- Disabled server-side response references for Zen conversations and removed internal routing metadata from provider request options, preserving complete tool-call and tool-result replay.
- Made ESC cancel only the active turn. Later prompts resume normally, cancellation notices remain beside the cancelled turn, and internal cancellation metadata is excluded from model prompts.
- Retried a transient provider failure once on the current model before selecting a fallback.

## New Provider: Cline

- Added Cline as an OAuth provider via `atomcli auth login --provider cline` with automatic credential refresh.
- Built the Cline model catalog dynamically from Cline's API: the promoted free list plus every catalog ID ending in `:free`, each with explicit zero pricing and AtomCLI Free eligibility.
- Enriched matching Cline entries with OpenRouter metadata (cached five minutes) for context limits, modalities, and reasoning variants; catalog loading continues when enrichment is unavailable.
- Listed Cline in the TUI picker with `Ctrl+A` before login, alongside other providers that expose an authentication method.

## Billing and Catalog Correctness

- Classified provider catalogs with missing prices as `UNKNOWN`; internal zero defaults never prove free access, and authenticated custom catalogs without pricing are treated as subscription access excluded from AtomCLI Free.
- Marked Antigravity OAuth models as plan/subscription entitlements; their internal zero-cost placeholders no longer qualify for `FREE` or AtomCLI Free routing.
- Refreshed OpenAI-compatible custom provider `/models` catalogs every 15 seconds while AtomCLI runs, so gateway changes appear without logout/login; `provider.<id>.options.modelDiscovery: false` keeps a deliberately static list.
- Detected reasoning support from gateway `supported_parameters` and output limits from `top_provider` metadata on custom providers.
- Scoped provider-native response state (Responses item IDs, encrypted reasoning) to the provider that produced it across history reload and compaction; cross-provider switches replay conversation content without those opaque handles.

## Tool Reliability and Unknown-Work Recovery

- Replaced the normal TUI prompt with a recovery panel when durable execution state holds unknown mutating work, resolving the oldest operation first with a verified-applied or not-applied decision; the failed prompt draft stays recoverable and is never resent automatically.
- Recorded filesystem permission failures before an edit or write reaches disk, browser target timeouts while still waiting for a locator, invalid tool arguments, rejected permissions, and missing edit matches as not applied, so the agent can retry another path without forced recovery.
- Kept read-only operations (LSP queries, browser inspection, system health, agent status) out of mutating recovery records while state-changing variants retain protection.
- Bounded post-write LSP diagnostics to two seconds of best-effort reporting so a language server cannot stall a successful filesystem change.

## Companion Beta

- No Flutter Companion application source changed relative to v3.4.3-debug; only the version line moved. The release workflow reuses the existing signed Companion APK when all APK inputs other than documentation and the version line are unchanged; otherwise it performs the normal signed build and certificate checks.

## Validation

- AtomBase typecheck passed.
- The fixture-backed AtomBase suite passed 1,685 tests with 10 opt-in tests skipped and no failures.
- Bundled guide discovery and its three focused tests passed.
- Live provider checks and physical-device behavior remain opt-in and environment-dependent.

Version `3.4.3-debug2` is prerelease metadata; the exact release tag is `v3.4.3-debug2`. Companion remains beta.
