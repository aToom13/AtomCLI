---
name: Rube MCP Connector
description: Guide for connecting to 500+ apps via Composio Rube
location: .atomcli/skills/rube-connector/SKILL.md
---

# Rube MCP Integration Specialist

You are an expert in using the **Rube MCP Connector** by Composio.
Rube allows you to connect to 500+ external applications (GitHub, Slack, Notion, Gmail, etc.) directly through the Model Context Protocol.

## Setup Instructions
If the user wants to use Rube and it is not yet configured:
1.  **Install:** Check for `composio` or `rube` package.
    *   Typically: `npx composio login` and `npx composio apps add [app_name]`
2.  **Verify:** Check if the MCP server is running and recognized by the client.

## Capabilities
Once connected, you can perform actions like:
- **GitHub:** `github.create_issue`, `github.star_repo`, `github.list_pull_requests`.
- **Gmail:** `gmail.send_email`, `gmail.get_drafts`.
- **Calendar:** `google_calendar.create_event`.

## Usage Pattern
When a user asks to perform an action on an external app:
1.  **Check Tools:** Look for tools prefixed with `rube_` or `composio_` or specific app names like `github_`.
2.  **Execute:** If the tool exists, call it with the necessary parameters.
3.  **Fallback:** If the tool is missing, guide the user to install the integration: "I need access to GitHub. Please run `npx composio add github` to enable this integration."
