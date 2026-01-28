# AtomCLI SDK

JavaScript/TypeScript SDK for integrating with AtomCLI.

## Overview

The SDK provides programmatic access to AtomCLI's functionality, allowing you to:
- Create and manage sessions
- Send messages to AI agents
- Access tool capabilities
- Subscribe to events

## Structure

- `js/` - JavaScript/TypeScript SDK implementation
- `openapi.json` - OpenAPI specification for the AtomCLI API

## Usage

```typescript
import { AtomCLI } from '@atomcli/sdk'

const client = new AtomCLI({
  baseURL: 'http://localhost:3000'
})

// Create a session
const session = await client.sessions.create()

// Send a message
await client.messages.send(session.id, {
  content: 'Hello, AtomCLI!'
})
```

## Documentation

- [SDK API Reference](js/README.md) - Detailed API documentation
- [Development Guide](../../docs/DEVELOPMENT.md) - Technical documentation
- [Main README](../../README.md) - Project overview

## Navigation

- **Parent**: [libs/](../README.md)
- **Root**: [AtomCLI](../../README.md)
