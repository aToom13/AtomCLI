# AI Providers Guide

AtomCLI supports multiple AI providers out of the box. This guide covers all supported providers, how to configure them, and comparison between free and paid options.

---

## Table of Contents

- [Provider Overview](#provider-overview)
- [Free Providers](#free-providers)
- [Paid Providers](#paid-providers)
- [Local Providers](#local-providers)
- [Configuration](#configuration)
- [Getting API Keys](#getting-api-keys)
- [Provider Comparison](#provider-comparison)

---

## Provider Overview

AtomCLI integrates with AI providers through the Vercel AI SDK. Providers are automatically detected and listed in the model selector.

### Quick Setup

1. Get an API key from your chosen provider
2. Add it to your config or set as environment variable
3. Select the model in AtomCLI

---

## Free Providers

AtomCLI offers several free model options that work without API keys.

> **Note**: Available free models may change over time. Check the model selector in AtomCLI for the current list.

### AtomCLI Free Models

AtomCLI includes built-in free providers such as MiniMax, GPT, GLM (Zhipu AI), Big Pickle, and DeepSeek. These are available immediately without any configuration.

- No API key required
- Rate limits may apply
- Models and availability may change

**How It Works**:

AtomCLI automatically fetches available public models from [models.dev](https://models.dev) API and caches them locally. The model list is refreshed periodically to ensure you always have access to the latest free models.

```typescript
// From src/integrations/provider/models.ts
const result = await fetch("https://models.dev/api.json", {
  headers: { "User-Agent": Installation.USER_AGENT },
  signal: AbortSignal.timeout(10 * 1000),
})
// Models are cached to ~/.cache/atomcli/models.json
```

This means AtomCLI can automatically discover and offer new free models as they become available, without requiring an update to the application itself.

### Antigravity (OAuth)

Antigravity provides access to premium models (Claude, Gemini) through Google OAuth authentication.

**Available Models**: Claude (Anthropic), Gemini (Google)

**How to Use**:
1. Select an Antigravity model in the model selector
2. Complete the Google OAuth authentication
3. Start using premium models for free

**Features**:
- Access to Claude and Gemini models
- No API key required
- Rate limited for fair usage
- Best for coding and complex tasks

---

## Paid Providers

These providers require API keys with paid usage.

### Anthropic

**Models**: claude-sonnet-4-20250514, claude-haiku-3-5

**Get API Key**: [console.anthropic.com](https://console.anthropic.com/)

```json
{
  "providers": {
    "anthropic": {
      "apiKey": "sk-ant-..."
    }
  }
}
```

**Environment Variable**: `ANTHROPIC_API_KEY`

### OpenAI

**Models**: gpt-4o, gpt-4-turbo, o1, o3-mini

**Get API Key**: [platform.openai.com](https://platform.openai.com/api-keys)

```json
{
  "providers": {
    "openai": {
      "apiKey": "sk-..."
    }
  }
}
```

**Environment Variable**: `OPENAI_API_KEY`

### Google AI

**Models**: gemini-2.0-flash, gemini-1.5-pro

**Get API Key**: [aistudio.google.com](https://aistudio.google.com/app/apikey)

```json
{
  "providers": {
    "google": {
      "apiKey": "AIza..."
    }
  }
}
```

**Environment Variable**: `GOOGLE_GENERATIVE_AI_API_KEY`

### Azure OpenAI

**Models**: Custom deployments

**Setup**: Requires Azure subscription and deployed models

```json
{
  "providers": {
    "azure": {
      "apiKey": "...",
      "resourceName": "my-resource",
      "deploymentId": "my-deployment"
    }
  }
}
```

**Environment Variables**: `AZURE_API_KEY`, `AZURE_RESOURCE_NAME`

### OpenRouter

**Models**: Access to 100+ models from various providers

**Get API Key**: [openrouter.ai](https://openrouter.ai/keys)

```json
{
  "providers": {
    "openrouter": {
      "apiKey": "sk-or-..."
    }
  }
}
```

**Environment Variable**: `OPENROUTER_API_KEY`

**Note**: OpenRouter routes to various providers. Quality may vary.

### xAI (Grok)

**Models**: grok-2, grok-2-vision

**Get API Key**: [x.ai](https://x.ai/)

```json
{
  "providers": {
    "xai": {
      "apiKey": "..."
    }
  }
}
```

### Mistral

**Models**: mistral-large, codestral

**Get API Key**: [console.mistral.ai](https://console.mistral.ai/)

```json
{
  "providers": {
    "mistral": {
      "apiKey": "..."
    }
  }
}
```

### Groq

**Models**: llama-3.1-70b, mixtral-8x7b

**Get API Key**: [console.groq.com](https://console.groq.com/)

```json
{
  "providers": {
    "groq": {
      "apiKey": "gsk_..."
    }
  }
}
```

**Note**: Very fast inference, good for iteration.

### Perplexity

**Models**: llama-3.1-sonar, pplx-online

**Get API Key**: [perplexity.ai](https://www.perplexity.ai/settings/api)

```json
{
  "providers": {
    "perplexity": {
      "apiKey": "pplx-..."
    }
  }
}
```

### Kilocode (v2.1.2+)

**Models**: Various premium models via Kilocode API or web

**Get API Key**: [kilocode.ai](https://kilocode.ai/)

```json
{
  "providers": {
    "kilocode": {
      "apiKey": "kl-..."
    }
  }
}
```

**Environment Variable**: `KILOCODE_API_KEY`

**How It Works**:

Kilocode is a unified AI API that provides access to multiple top-tier models through a single endpoint. AtomCLI integrates with Kilocode to offer:

- **Model Aggregation**: Access to GPT-4, Claude, Gemini, and more through one provider
- **Smart Routing**: Automatic model selection based on task complexity
- **Cost Optimization**: Intelligent caching and request optimization
- **High Availability**: Built-in fallback between models

**Configuration Options**:

```json
{
  "providers": {
    "kilocode": {
      "apiKey": "kl-...",
      "baseURL": "https://api.kilocode.ai/v1",
      "models": {
        "gpt-4o": {
          "name": "GPT-4o via Kilocode",
          "cost": { "input": 2.5, "output": 10 }
        },
        "claude-sonnet-4": {
          "name": "Claude Sonnet via Kilocode",
          "cost": { "input": 3, "output": 15 }
        }
      }
    }
  }
}
```

**Features**:
- Single API key for multiple models
- Built-in retry and fallback mechanisms
- Usage analytics and cost tracking
- Enterprise-grade SLA

**Best For**:
- Teams needing multiple model access
- Production applications requiring high availability
- Cost-conscious users wanting optimized pricing

### Together AI

**Models**: Various open source models

**Get API Key**: [api.together.xyz](https://api.together.xyz/)

```json
{
  "providers": {
    "together": {
      "apiKey": "..."
    }
  }
}
```

### Cerebras

**Models**: llama-3.1-70b (fast inference)

**Get API Key**: [cloud.cerebras.ai](https://cloud.cerebras.ai/)

```json
{
  "providers": {
    "cerebras": {
      "apiKey": "..."
    }
  }
}
```

### Cohere

**Models**: command-r-plus

**Get API Key**: [dashboard.cohere.com](https://dashboard.cohere.com/)

```json
{
  "providers": {
    "cohere": {
      "apiKey": "..."
    }
  }
}
```

### Amazon Bedrock

**Models**: Various models via AWS

**Setup**: Requires AWS credentials

```json
{
  "providers": {
    "bedrock": {
      "region": "us-east-1",
      "accessKeyId": "...",
      "secretAccessKey": "..."
    }
  }
}
```

### Google Vertex AI

**Models**: Gemini, Claude (via Vertex)

**Setup**: Requires GCP project and credentials

```json
{
  "providers": {
    "vertex": {
      "project": "my-gcp-project",
      "location": "us-central1"
    }
  }
}
```

---

## Local Providers

### Ollama

Run models locally on your machine.

**Setup**:
1. Install Ollama: [ollama.ai](https://ollama.ai/)
2. Pull a model: `ollama pull llama3.1`
3. Start Ollama: `ollama serve`

AtomCLI automatically detects running Ollama instances.

```bash
atomcli -m ollama/llama3.1
```

**Popular Models**:
- `llama3.1` - Meta's Llama 3.1
- `codellama` - Code-focused Llama
- `mistral` - Mistral 7B
- `deepseek-coder` - DeepSeek Coder

**Custom Ollama URL**:
```json
{
  "providers": {
    "ollama": {
      "baseURL": "http://localhost:11434"
    }
  }
}
```

---

## Configuration

### Config File Location

`~/.config/atomcli/config.json`

### Full Example

```json
{
  "model": "anthropic/claude-sonnet-4",
  "providers": {
    "anthropic": {
      "apiKey": "sk-ant-..."
    },
    "openai": {
      "apiKey": "sk-..."
    },
    "ollama": {
      "baseURL": "http://localhost:11434"
    }
  },
  "disabled_providers": ["openrouter"]
}
```

### Environment Variables

All providers support environment variables:

| Provider   | Environment Variable           |
| ---------- | ------------------------------ |
| Anthropic  | `ANTHROPIC_API_KEY`            |
| OpenAI     | `OPENAI_API_KEY`               |
| Google     | `GOOGLE_GENERATIVE_AI_API_KEY` |
| Azure      | `AZURE_API_KEY`                |
| OpenRouter | `OPENROUTER_API_KEY`           |
| Mistral    | `MISTRAL_API_KEY`              |
| Groq       | `GROQ_API_KEY`                 |
| xAI        | `XAI_API_KEY`                  |
| Perplexity | `PERPLEXITY_API_KEY`           |

### Disabling Providers

```json
{
  "disabled_providers": ["openrouter", "together"]
}
```

### Enabling Only Specific Providers

```json
{
  "enabled_providers": ["anthropic", "openai"]
}
```

---

## Provider Comparison

### Coding Performance

| Provider  | Model            | Quality   | Speed     | Cost |
| --------- | ---------------- | --------- | --------- | ---- |
| Anthropic | claude-sonnet-4  | Excellent | Medium    | $$$  |
| OpenAI    | gpt-4o           | Excellent | Fast      | $$   |
| Google    | gemini-2.5-pro   | Excellent | Fast      | $$   |
| Anthropic | claude-haiku-3-5 | Good      | Fast      | $    |
| Groq      | llama-3.1-70b    | Good      | Very Fast | $    |
| Ollama    | llama3.1         | Good      | Varies    | Free |

### Context Window

| Provider  | Model           | Context     |
| --------- | --------------- | ----------- |
| Google    | gemini-2.5-pro  | 1M tokens   |
| Anthropic | claude-sonnet-4 | 200K tokens |
| OpenAI    | gpt-4-turbo     | 128K tokens |
| DeepSeek  | deepseek-coder  | 64K tokens  |
| Mistral   | mistral-large   | 32K tokens  |

### Free vs Paid

| Use Case           | Recommended                      |
| ------------------ | -------------------------------- |
| Learning / Testing | Antigravity (free Claude/Gemini) |
| Personal Projects  | Antigravity or Ollama            |
| Professional       | Anthropic or OpenAI API          |
| High Volume        | Groq or Cerebras (fast + cheap)  |
| Privacy Required   | Ollama (local)                   |

---

## Troubleshooting

### Provider Not Showing

1. Check API key is set correctly
2. Restart AtomCLI
3. Check `atomcli mcp list` for errors

### Rate Limits

Free tiers have rate limits. Solutions:
- Wait and retry
- Switch to paid API key
- Use local Ollama

### Connection Errors

```bash
# Check provider status
atomcli /status
```

---

## Related Documentation

- [Development Guide](./DEVELOPMENT.md) - Technical documentation
- [MCP Guide](./MCP-GUIDE.md) - Extending with MCP servers
- [Skills Guide](./SKILLS-GUIDE.md) - Custom agent behaviors
- [Memory Integration](./MEMORY-INTEGRATION.md) - Semantic memory system
