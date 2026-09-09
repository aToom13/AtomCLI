# Providers and models

## Connect and inspect

```sh
atomcli auth login
atomcli auth list
atomcli models
atomcli models <provider>
```

For non-interactive login selection, inspect current help first:

```sh
atomcli auth login --help
```

The login command can target a provider with `--provider` and, where several authentication methods exist, a method with `--method`. OAuth providers may open or print an authorization URL. API-key providers may accept credentials through their login flow or supported environment variables.

### Cline

Connect Cline through browser OAuth, then inspect its current free catalog:

```sh
atomcli auth login --provider cline
atomcli models cline
```

AtomCLI refreshes Cline credentials automatically. Its model list is dynamic: it combines Cline's promoted free list with every API catalog ID ending in `:free`. This includes free variants such as Gemma even when they are absent from Cline's promoted UI list. Every model in this union has explicit zero pricing and is eligible for AtomCLI Free verification. Temporary upstream 404, 429, quota, or availability errors do not change that billing classification; they still prevent verification until the model works again.

Matching OpenRouter metadata, cached for five minutes, supplies context limits, modalities, and reasoning controls. Reasoning-capable Cline models expose their thinking variants in the TUI and through `--variant`. Cline catalog loading continues without enrichment if the metadata endpoint is unavailable.

Log out through the interactive provider selection:

```sh
atomcli auth logout
```

Never infer successful access solely from the model catalog. Credentials, subscriptions, account entitlements, network access, and provider policies all affect availability.

Antigravity OAuth models are plan/subscription entitlements, not free models. Zero-valued internal price placeholders remain excluded from AtomCLI Free routing.

## Model identifiers and selection

Model identifiers always use the first slash as the provider/model boundary:

```text
providerID/modelID
```

Examples of selection mechanisms:

```sh
atomcli -m provider/model
atomcli run -m provider/model "Explain this project"
```

In the TUI:

```text
/model select
/models
```

The picker searches model name, ID, provider, family, and reported capabilities. It exposes favorites plus free and reasoning-capable filters. `Ctrl+A` also lists providers with auth methods before login, including Cline even when no connected Cline model catalog exists. Use the local picker or `atomcli models` for IDs that exist in the installed catalog.

Inspect richer catalog metadata or refresh it:

```sh
atomcli models --verbose
atomcli models --refresh
```

## Thinking and variants

Set a supported reasoning level in the TUI:

```text
/model think
/model think high
```

Only levels supported by the active model should be offered. Thinking visibility is separate from reasoning effort:

```text
/model visibility
```

For non-interactive execution, use the provider-specific variant:

```sh
atomcli run --variant high "Solve this task"
```

Do not claim a variant exists without checking the active model.

## Adaptive model and thinking proposals

The optional `adaptive_routing` block controls model proposals with `mode: "off" | "ask" | "auto"`; `thinking.mode` controls thinking-level proposals independently and both default to `ask`. `auto` does not itself grant provider, paid-model, or probe authority. Automatic application requires a trusted user grant bounded to the exact target and execution limits.

The conversational model uses `model_control` to recommend model/thinking changes; natural-language intent is not matched with regex. Authentication, quota, network, permission, and storage failures are not task-difficulty evidence. Do not edit config files or search source code when the user asks to change the conversation model.

Use `model_control` with `action: "list"` (optional `query`) to discover connected IDs and supported variants. Then `action: "request"` requires `providerID`, `modelID` and `reason`. `scope: "model"` changes the conversation selection; `thinking` changes its reasoning level; `expert` starts a bounded read-only episode on a configured expert. Only main conversations can request switches. Clarify ambiguous targets rather than inventing IDs.

In the default `ask` mode, model and thinking approval uses the normal inline question flow, so the same request reaches the TUI and Companion question inbox/notification path. The answer is recorded as the durable route decision. The runtime pauses subsequent model calls while approval is pending. Rejection, cancellation or expiry does not apply the route. After approval, parameters, credentials and text/tool verification must pass before application. Never describe a pending or merely accepted request as a completed switch. The TUI changes its selection only after application.

For example, “set the model to GPT 5.6 Luna” should use the list/request tool sequence. This depends on the current model's tool-calling reliability, not an offline intent parser; the model picker remains the direct fallback. Approving a concrete model change can leave Free, with paid/subscription verification deferred until confirmation. Auto/Free requests retain the alias selection and its pricing/verification restrictions. Automatic recommendations respect manual pins and require exact grants for auto-acceptance.

Eligibility is fail-closed: connection, provider/model allowlists, Free pricing, permission, capabilities, modalities, context/output limits, variant support, and current verification must all pass. A score cannot relax these constraints, and an accepted proposal changes nothing until a safe step boundary applies it.

Zen conversation requests disable server-side response storage, so replay sends complete tool-call/output pairs instead of temporary provider item references that Zen cannot reliably resolve.

ChatGPT OAuth verification must stream Responses, just like normal dispatch; non-streaming requests are rejected by that endpoint. OAuth probes omit unsupported output-token limits but retain timeouts, instructions and `store: false`. API-key probes keep completion requests and output limits. Neither path records success without actual text or a valid verification tool call.

Use `/model adaptive-routing off|ask|auto` (or the compatible `/adaptive-routing` command) in the TUI to change or stop proposals. Ctrl+P → Model → Auto / Free Model Settings also offers model/thinking proposal modes and separate paid-model/paid-probe switches; Free remains verified and zero-cost. The session route strip reports the concrete active route, thinking variant, base/expert stage, manual pin, and call budget. Explicit model and thinking choices are pinned and take precedence over automation.

Cold verification completes text/tool checks for batches of two candidates within a shared 30-second deadline, stopping once a model is eligible. Cached probe results are released after use, so expired evidence and cooldowns can be retried without restarting.

Category overrides retain alternative candidates, and provider-qualified exclusions apply before probing. Auto/Free settings include direct alias selection; save preferences before switching. Saving uses the configured SDK connection and reports failures before updating local settings.

Even greetings may be sent with Agent tools enabled. Dispatch verifies missing tool evidence or changed parameters using the exact prepared parameters before sending the request, without rerunning parameter plugins. Probes remain bounded by time, cooldowns, cancellation, and execution budgets. Free never probes paid models; Auto needs both paid-model and paid-probe permission.

Object-union tool schemas keep their alternatives and receive a root object type for providers such as Cohere. This lets the verification result match the real Agent tool payload more closely.

## Smart routing

Smart routing lets AtomCLI choose a model by task category:

```sh
atomcli smart-model status
atomcli smart-model on
atomcli smart-model off
atomcli smart-model toggle
```

TUI equivalent:

```text
/model smart
```

Use explicit `-m provider/model` when reproducibility matters more than automatic routing.

### AtomCLI Auto and Free verification

`atomcli/atomcli-auto` and `atomcli/atomcli-free` choose only candidates with fresh evidence for the capabilities required by the task. Catalog metadata and HTTP 200 alone are not sufficient. AtomCLI uses bounded text and side-effect-free tool probes, shares their TTL-based results across processes, and refreshes evidence from completed non-empty real calls. The evidence key includes a safe fingerprint of the effective endpoint and credential/configuration identity; secrets are not persisted.

By default, both aliases consider explicitly zero-cost models from connected providers. Free keeps its free-only and verification requirements through retry, fallback, tool turns, compaction, memory helpers, and child sessions. Unknown price is not free, and no route silently falls back to a paid model. Auto can consider verified paid models only with `experimental.auto_router.allow_paid_models: true`; automatic paid probes additionally require `allow_paid_probes: true`. Limit either alias's candidate set with `allowed_providers`. Free ignores the paid flags and remains free-only.

When no verified eligible candidate remains, AtomCLI stores a visible assistant error under the selected Auto/Free alias instead of leaving the prompt unanswered or restoring excluded, unavailable, unverified, capability-incompatible, or non-free candidates. The TUI also surfaces transport failures and does not automatically resend an uncertain prompt.

Automatic verification considers ranked candidates within one shared deadline. Text and tool probes use separate bounded output allowances. A timeout or output-limited completion without visible text/tool proof is inconclusive, not verified, and observes a retry cooldown. Usage returned by the provider is accounted even when the returned content fails verification.

Evidence is bound to the requested reasoning variant and its adapter options. Proof for `high` does not authorize `max`; stale or unsupported variants fail visibly rather than falling back to provider defaults.

## Fallback models

Retryable provider failures receive one retry on the current model before AtomCLI selects a fallback. Cancelling with ESC ends only the active turn; cancellation notices remain chronological and their internal metadata is not sent to the provider. The next user message starts a new execution normally.

Provider-native response state, including Responses item IDs and encrypted reasoning, survives history reload and compaction only while dispatch stays on the provider that produced it. Cross-provider model changes and fallbacks keep the conversation content but omit those opaque handles; an OpenAI-compatible gateway's `openai` metadata namespace does not make its item IDs valid for the OpenAI provider.

Inspect, test, or configure fallback models:

```sh
atomcli fallback --list
atomcli fallback --probe
atomcli fallback --probe --capability tool --force
atomcli fallback --secondary provider/model --tertiary provider/model --enable
atomcli fallback --reset
```

`--probe` makes real model requests, updates the shared capability evidence, and may consume quota or incur provider costs. Use `--capability text|tool`; `--force` explicitly bypasses fresh evidence and cooldowns. Explain the cost risk before running it.

Equivalent config shape:

```jsonc
{
  "fallback": {
    "enabled": true,
    "secondary": "provider/model",
    "tertiary": "provider/model",
  },
}
```

## Provider overrides

Provider overrides use the singular `provider` key:

```jsonc
{
  "provider": {
    "openai": {
      "options": {
        "apiKey": "{env:OPENAI_API_KEY}",
        "baseURL": "https://api.openai.com/v1",
        "timeout": 30000,
      },
      "whitelist": ["model-id"],
      "blacklist": ["other-model-id"],
    },
  },
}
```

Project overrides take precedence over global settings. Check both scopes when a provider behaves differently in one repository.

## Access and price labels

- `FREE` means the catalog explicitly reports zero input and output cost and the provider is not classified as subscription access.
- `PLAN` or `SUBSCRIPTION` means access is associated with a connected subscription. It does not mean zero cost or unlimited use.
- `UNKNOWN` means the provider catalog omitted usable prices. Internal zero defaults never prove free access.

OpenAI-compatible custom providers refresh `/models` every 15 seconds while AtomCLI runs, so gateway changes appear without logout/login. Authenticated catalogs with missing prices are classified as subscription access and excluded from AtomCLI Free. Explicit zero pricing remains required for `FREE`; use `provider.<id>.options.modelDiscovery: false` for a deliberately static model list.
- Metered catalog prices are informational and may not reflect account-specific billing or negotiated limits.

For financial decisions, tell the user to confirm current billing with the provider.

## Ollama and local models

When a reachable Ollama server exists:

```sh
ollama pull llama3.1
atomcli models ollama
atomcli -m ollama/llama3.1
```

Configure a non-default endpoint with `provider.ollama.options.baseURL`.

## Troubleshooting order

1. `atomcli auth list`
2. `atomcli models <provider>`
3. Confirm the exact `provider/model` spelling.
4. Inspect project and global provider overrides.
5. Run the failing command with `--print-logs`.
6. Refresh the catalog only if stale metadata is plausible: `atomcli models --refresh`.

If every anonymous `atomcli/*-free` model reports that the free tier only works in OpenCode, update AtomCLI; current builds forward the Zen session identity required by the gateway.

The models.dev cache under `~/.atomcli/cache/models.json` is regenerable implementation data, not the source of credentials or account entitlement.
