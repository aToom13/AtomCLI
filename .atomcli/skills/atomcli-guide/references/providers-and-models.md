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

Log out through the interactive provider selection:

```sh
atomcli auth logout
```

Never infer successful access solely from the model catalog. Credentials, subscriptions, account entitlements, network access, and provider policies all affect availability.

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

The picker searches model name, ID, provider, family, and reported capabilities. It exposes favorites plus free and reasoning-capable filters. Use the local picker or `atomcli models` for IDs that exist in the installed catalog.

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

## Fallback models

Inspect, test, or configure fallback models:

```sh
atomcli fallback --list
atomcli fallback --probe
atomcli fallback --secondary provider/model --tertiary provider/model --enable
atomcli fallback --reset
```

`--probe` makes real model requests and may consume quota or incur provider costs. Explain that before running it.

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

The models.dev cache under `~/.atomcli/cache/models.json` is regenerable implementation data, not the source of credentials or account entitlement.
