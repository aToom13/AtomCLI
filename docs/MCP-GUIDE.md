# MCP Guide

Model Context Protocol (MCP) servers add external tools and resources to AtomCLI. AtomCLI supports locally launched servers and remote servers, including remote OAuth flows where supported by the server.

## Commands

```sh
atomcli mcp list
atomcli mcp add
atomcli mcp install filesystem
atomcli mcp install @scope/server-name
atomcli mcp remove <name>
atomcli mcp debug <name>
atomcli mcp auth <name>
atomcli mcp logout <name>
```

`mcp add` is interactive, but it does not write configuration. For local and OAuth-free remote servers it only collects or tests the connection details, so create the matching `mcp.json` entry yourself. For an OAuth remote server it prints a configuration snippet to copy. `mcp install` prepares a registry or package-based server configuration and prints the entry to add; it does not silently install or enable a server. Use `mcp list` to inspect the effective result.

## Configuration

MCP entries can live in global `~/.atomcli/mcp.json`, global AtomCLI config, or a project `mcp.json`. A bare `mcp.json` is interpreted as the MCP map; the same data may also appear beneath `mcp` in `atomcli.json` or `atomcli.jsonc`.

Local servers use a command array:

```json
{
  "filesystem": {
    "type": "local",
    "command": ["bunx", "@modelcontextprotocol/server-filesystem", "."],
    "environment": { "HOME": "/home/user" },
    "enabled": true,
    "timeout": 10000
  }
}
```

Remote servers use a URL:

```json
{
  "example": {
    "type": "remote",
    "url": "https://example.com/mcp",
    "headers": { "X-Custom-Header": "value" },
    "oauth": { "scope": "read write" },
    "enabled": true,
    "timeout": 5000
  }
}
```

Supported fields for both types:

| Field         | Types  | Purpose                                                                                              |
| ------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| `command`     | local  | Command and arguments used to launch the server                                                      |
| `environment` | local  | Extra environment variables set for the launched server process                                      |
| `url`         | remote | Endpoint of the remote MCP server                                                                    |
| `headers`     | remote | HTTP headers sent with requests to the server                                                        |
| `oauth`       | remote | OAuth settings (`clientId`, `clientSecret`, `scope`); set to `false` to disable OAuth auto-detection |
| `enabled`     | both   | Enable or disable the server on startup without removing its entry                                   |
| `timeout`     | both   | Milliseconds allowed for fetching tools from the server; defaults to 5000                            |

For OAuth servers that require dynamic client registration, omitting `clientId` is sufficient; AtomCLI registers itself where the authorization server supports it.

For a remote server that requires OAuth, use the interactive `atomcli mcp add` flow or add the server's OAuth settings according to the configuration schema. Never place client secrets in a project configuration file that is committed to version control.

## Security and diagnosis

An MCP server is an external program or network service with the permissions you grant it. Review its command, arguments, environment, and access scope before enabling it. Prefer a narrowly scoped directory argument for filesystem servers.

Use `atomcli mcp debug <name>` for OAuth connection diagnostics and `atomcli --print-logs` for broader runtime logs.
