# ACP integration

This directory implements AtomCLI's Agent Client Protocol integration using `@agentclientprotocol/sdk`. `agent.ts` adapts AtomCLI sessions to the ACP agent side, `session.ts` tracks ACP session state, and `types.ts` contains integration types.

Start the protocol endpoint with:

```sh
atomcli acp
atomcli acp --cwd /path/to/project
```

The command starts AtomCLI's HTTP server for its internal SDK client and communicates with the ACP client through standard input and output using newline-delimited JSON. Network options are shared with the server command; inspect `atomcli acp --help` for current flags.

ACP advertises the `atomcli-login` authentication method. Clients with the terminal-auth extension run `atomcli auth login`; AtomCLI then verifies that the command actually produced a stored credential before reporting authentication success. Credentials are never requested through a chat message. Prompt responses are derived from the durable execution outcome: cancellation, refusal/blocking, and budget or turn limits are not reported as a successful `end_turn`. The precise AtomCLI outcome and safe reason code are included in response metadata.

Companion support also uses the shared network options. An automatic Companion listener prefers port 4096 and falls back to an available port when another AtomCLI process owns it; an explicit `--companion-port` remains fixed and fails on collision. Endpoint output must always use the actual bound port.

Protocol behavior should be verified against the installed ACP SDK and its specification rather than this overview alone.
