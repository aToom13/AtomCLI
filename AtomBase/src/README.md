# AtomCLI Source Code

Main source code directory for AtomCLI.

## Overview

This directory contains the core implementation of AtomCLI, organized into focused modules for maintainability and clarity.

## Key Modules

### Core Systems
- **[cli/](cli/README.md)** - CLI commands and TUI implementation
- **[session/](session/README.md)** - Session and message handling
- **[agent/](agent/README.md)** - AI agent implementation
- **[provider/](provider/README.md)** - AI provider integrations
- **[tool/](tool/README.md)** - Agent tool implementations

### Infrastructure
- **[server/](server/README.md)** - HTTP server and API routes
- **[config/](config/README.md)** - Configuration management
- **[bus/](bus/README.md)** - Event bus system
- **[mcp/](mcp/README.md)** - MCP server management

### Utilities
- **[util/](util/README.md)** - Shared utilities
- **[file/](file/README.md)** - File system operations
- **[auth/](auth/README.md)** - Authentication
- **[permission/](permission/README.md)** - Permission system

## Entry Points

- `index.ts` - Main application entry point
- `shim.ts` - Runtime shims and polyfills

## Documentation

- [Development Guide](../../docs/DEVELOPMENT.md) - Architecture and modules
- [Main README](../../README.md) - Project overview

## Navigation

- **Parent**: [AtomBase/](../README.md)
- **Root**: [AtomCLI](../../README.md)
