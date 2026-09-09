# Provider and Model Guide

AtomCLI builds its provider catalog from its built-in integrations, configured providers, plugins, and the models.dev catalog. Availability depends on your credentials, configuration, network access, and the selected model's capabilities. Do not treat a static provider list as authoritative; inspect the local catalog instead.

## Authenticate and choose a model

```sh
atomcli auth login
atomcli auth list
atomcli models
atomcli models openai
atomcli -m provider/model
atomcli run -m provider/model "Explain this project"
```

`atomcli auth login` presents the available authentication methods. `atomcli models [provider]` lists the models currently known to this installation. Model identifiers always use `provider/model` format.

### Cline free models

Run `atomcli auth login --provider cline` and complete the browser sign-in. AtomCLI refreshes the OAuth token when needed, then builds the `cline` catalog from Cline's current API instead of shipping a fixed model list:

- models promoted by Cline's `recommended-models` free list;
- every catalog model whose ID ends in `:free`, including models such as Gemma that may not appear in Cline's promoted UI list.

Both groups are marked explicitly zero-cost and can participate in `atomcli/atomcli-free`. A free classification describes current billing metadata, not current health: upstream quota, 404, or 429 failures can still make an individual model temporarily unavailable. Check the live list with `atomcli models cline` after login.

AtomCLI enriches matching Cline entries from OpenRouter's public model metadata, cached for five minutes. Reasoning-capable models then expose supported thinking variants in the TUI and through `--variant`; catalog loading still works if metadata enrichment is unavailable.

The interactive TUI also exposes provider and model selection. Enter `/model` or `/models` to open the model picker. Search matches model names, IDs, providers, families, and capabilities. The picker groups favorites and recent models before provider sections and shows the current model with a dot. `Ctrl+A` includes providers that expose an authentication method even before they have a connected model catalog, so Cline can be selected there before login.

Model picker shortcuts:

| Shortcut | Action                                             |
| -------- | -------------------------------------------------- |
| `Ctrl+A` | Open provider connection and management            |
| `Ctrl+F` | Add or remove the highlighted model from favorites |
| `Ctrl+E` | Toggle the confirmed-free model filter             |
| `Ctrl+R` | Toggle the reasoning-capable model filter          |

The highlighted row stays visible while navigating with the arrow or page keys. On taller terminals, the details panel shows context/output limits, access or pricing information, and reported capabilities. The dialog is centered within the terminal and constrains itself on shorter screens.

### Pricing and access labels

The model picker distinguishes these access types:

- `FREE`: the catalog explicitly reports zero input and output cost and the provider does not use subscription access.
- `PLAN` / `SUBSCRIPTION`: the model is available through a connected subscription, such as ChatGPT OAuth for Codex models. This does not mean the model is free.
- `UNKNOWN`: the provider did not publish usable pricing. Zero-filled internal defaults are never proof of free access.

OpenAI-compatible custom providers refresh `/models` every 15 seconds while AtomCLI runs. Newly linked gateway models therefore appear without logout/login. Authenticated custom catalogs that omit pricing are shown as subscription access and remain excluded from AtomCLI Free; explicit zero pricing is required for `FREE`. Set `provider.<id>.options.modelDiscovery` to `false` only for a deliberately static catalog.
- Models with metered catalog pricing do not receive a free badge; their per-million-token input and output prices appear in the details panel.

Pricing metadata is informational and may differ from account-specific billing or entitlement. Confirm current limits and charges with the provider before relying on a model for paid workloads.

Antigravity OAuth models are subscription/plan entitlements. Their internal zero-cost placeholders do not qualify them for `FREE` or AtomCLI Free routing.

### AtomCLI Auto and AtomCLI Free

`atomcli/atomcli-auto` and `atomcli/atomcli-free` resolve at execution time. They do not treat catalog presence or an HTTP success status as proof that a model works. AtomCLI first requires fresh, capability-specific evidence from a bounded text or side-effect-free tool-call probe; completed real requests refresh the same evidence. Evidence expires after a TTL and is isolated by the effective provider, real model, endpoint, credentials/configuration fingerprint, and capability without storing credentials.

By default, both aliases consider explicitly zero-cost models from connected providers. `AtomCLI Free` always carries a hard free-only route policy through retries, fallback, later tool turns, compaction, memory helpers, and orchestrated child sessions. Unknown pricing is not considered free, and a paid fallback is never selected silently. `AtomCLI Auto` may consider verified paid models only when `experimental.auto_router.allow_paid_models` is explicitly enabled. Paid verification probes require the separate `allow_paid_probes` opt-in because probing can incur cost. Use `allowed_providers` to bound the candidate set.

```jsonc
{
  "experimental": {
    "auto_router": {
      "allowed_providers": ["atomcli", "openai"],
      "allow_paid_models": true,
      "allow_paid_probes": false,
    },
  },
}
```

With this example, Auto can reuse fresh evidence for a paid OpenAI model but will not spend money probing it automatically. Free ignores both paid flags and remains free-only.

If no eligible verified candidate exists, the session stores a visible assistant error under the selected Auto/Free alias instead of leaving only the user's message or relaxing exclusions, price, capabilities, or verification. The TUI also reports transport failures immediately. Reloading history preserves the model-selection failure and does not resubmit the prompt automatically.

Retryable provider failures receive one retry on the current model before fallback selection begins. Cancelling with ESC ends only the active turn; cancellation notices remain in chronological order, and their internal metadata is not forwarded to the next provider prompt. A later user message starts a new execution normally.

Provider-native response state, including Responses API item IDs and encrypted reasoning, is retained when history, resume, or compaction continues on the provider that created it. A model switch or fallback to a different provider replays the conversation content without those opaque handles because response item IDs are scoped to their producing provider, even when an OpenAI-compatible gateway reports them in the `openai` metadata namespace.

Automatic verification examines ranked candidates within a shared time bound rather than repeatedly stopping at the first three. Text and tool probes have separate bounded output allowances. A timeout or an output-limit completion without visible proof is recorded as inconclusive and retried only after its cooldown; it is not accepted as verification. When a provider returns usage before content validation fails, the real usage is still accounted. `atomcli fallback --probe --capability text` (or `tool`) makes real provider requests and updates the shared verification evidence; `--force` explicitly ignores fresh evidence and cooldowns. A probe may consume provider quota.

Verification evidence is also bound to the selected reasoning variant and its adapter options. A `high` result cannot authorize `max`, and a stale or unsupported variant is rejected visibly instead of silently using the model default.

AtomCLI sends Zen conversation requests with server-side response storage disabled. Session replay therefore includes complete tool-call/output pairs instead of temporary provider item references that Zen cannot reliably resolve.

ChatGPT OAuth verification uses streaming Responses requests, like normal conversation dispatch. These probes omit the unsupported output-token limit and remain bounded by the probe deadline; standalone probes also supply the required instructions and `store: false`. OpenAI API-key probes retain the normal completion path and output limits. Both paths still require visible text or a valid verification tool call before recording success.

`adaptive_routing` configures model and thinking proposals. Both default to `ask`; `off` disables proposals and `auto` only reuses a trusted user grant for the exact target, parameters, scope and execution. The conversational model decides when to recommend a switch through `model_control`; natural-language switching is not implemented with keyword/regex intent matching. Provider authentication, quota, network, permission, and storage errors are not reasons to escalate task difficulty.

For “set the model to GPT 5.6 Luna”, the model should call `model_control` with `action: "list"` to discover exact connected IDs, then `action: "request"` with the target and a reason. It must not edit configuration or search repository files to change the conversation model. Ambiguous names should be clarified. This uses the current model's tool-calling capability; it is not a guaranteed offline natural-language command. The model picker remains available if the provider cannot call tools reliably.

`scope: "model"` changes the conversation selection, `thinking` changes the current model's supported reasoning variant, and `expert` starts a bounded read-only episode using a configured expert. Main conversations alone can request switches. Automatic expert/thinking recommendations respect manual pins. In the default `ask` mode, model changes use the same inline question flow as other agent questions, including Companion delivery; the answer is then recorded as the durable route decision. A pending request pauses further model calls until approval, rejection, cancellation or expiry. Rejection and expiry leave the model unchanged.

Approval is not yet application: effective parameters and credential identity must still match and text/tool verification must succeed before the safe-boundary switch. Failure is visible; it never silently continues with the old model while claiming success. A confirmed concrete model change can leave Free, with paid/subscription verification deferred until after approval. Auto/Free targets retain their alias in the conversation selection and their pricing/verification constraints in dispatch. TUI selection updates only after application, not merely approval.

In the TUI, use `/model adaptive-routing off|ask|auto` (also available as `/adaptive-routing`) to change or immediately stop model proposals. Ctrl+P → Model → Auto / Free Model Settings exposes model and thinking proposal modes alongside Auto/Free preferences and separate paid-model/paid-probe switches. Free always remains verified and zero-cost. The active route strip shows the concrete provider/model, thinking variant, base/expert stage, manual pin state, and execution call budget. Explicit model or thinking selection pins that choice above later proposals.

Cold verification has a shared 30-second deadline and completes text/tool checks in batches of two candidates before advancing, stopping once an eligible model is found. Settled probe promises are released even on cached results or lock failures, allowing expired evidence and cooldowns to be checked again without restarting AtomCLI.

Category overrides prefer a model without removing alternative verification candidates. Provider-qualified exclusions (`provider/model`) apply before probing. The Auto/Free settings dialog also offers direct alias selection; save changed preferences before switching. Settings updates use the configured SDK connection and report server errors before changing local state.

Agent dispatch checks the actual enabled tools, even for a greeting that the local classifier treats as text-only. Missing capability evidence or changed dispatch parameters trigger bounded verification using the already prepared parameters before the user request is sent. Parameter plugins are not rerun for that probe. Free never permits paid verification; Auto requires both paid routing and paid probe opt-ins. Existing exclusions, cooldowns, cancellation, and execution budgets still apply.

Tool schemas whose root is a union of objects retain that union and receive the standard root `type: "object"`. This keeps discriminated tools such as memory valid while satisfying providers such as Cohere that reject typeless root tool schemas.

```jsonc
{
  "adaptive_routing": {
    "mode": "ask",
    "thinking": { "mode": "ask" },
    "base_models": ["atomcli/atomcli-free"],
    "expert_models": ["openai/gpt-5.6-sol"],
    "max_expert_episodes": 2,
    "max_expert_calls": 3,
    "max_expert_steps": 3,
    "cooldown_steps": 3,
    "proposal_ttl_ms": 120000,
    "return_to_base": true,
  },
}
```

Candidate scoring never overrides provider connection, allowlist, Free pricing, permission, capability, modality, context/output, supported-variant, or current-verification requirements. Until a proposal is accepted and applied at a safe step boundary, the active route does not change.

## Configuration

Global configuration is stored under `~/.atomcli/`. The loader reads `config.json`, `atomcli.json`, `atomcli.jsonc`, and `mcp.json` there. A project may provide `atomcli.jsonc`, `atomcli.json`, or `mcp.json`; project configuration takes precedence over global configuration. `ATOMCLI_CONFIG_CONTENT` has the highest precedence.

Provider overrides use the singular `provider` object:

```jsonc
{
  "provider": {
    "openai": {
      "options": {
        "apiKey": "{env:OPENAI_API_KEY}",
        "baseURL": "https://api.openai.com/v1",
      },
      "whitelist": ["gpt-4.1"],
    },
  },
}
```

`apiKey`, `baseURL`, `timeout`, model overrides, `whitelist`, and `blacklist` are supported provider configuration fields.

Two substitution placeholders are available in configuration files:

- `{env:VARIABLE_NAME}` is replaced with the value of that environment variable, or an empty string when unset.
- `{file:PATH}` is replaced with the contents of the referenced file, resolved relative to the configuration file's directory. This is useful for reading secrets such as API keys from files outside version control.

Prefer `atomcli auth login` or environment variables for credentials instead of committing secrets to a project file.

## Local models

AtomCLI includes an Ollama integration when a reachable Ollama server is available. Start Ollama, pull a model, then inspect and select it:

```sh
ollama pull llama3.1
atomcli models ollama
atomcli -m ollama/llama3.1
```

If your local endpoint differs from the provider default, configure its `provider.ollama.options.baseURL` value.

## Model catalog cache

The models.dev catalog is cached at `~/.atomcli/cache/models.json`. It is an implementation cache, not configuration; it can be safely regenerated by AtomCLI. A catalog refresh never guarantees that an account is entitled to every listed model.

## Troubleshooting

- Run `atomcli auth list` to inspect stored credentials.
- Run `atomcli models <provider>` to confirm the local model identifier.
- Use `atomcli --print-logs` for diagnostics.
- Check the configured `provider` entry and any project-level override before changing global configuration.
- If every anonymous `atomcli/*-free` model reports that the free tier only works in OpenCode, update AtomCLI; current builds forward the Zen session identity required by the gateway.
