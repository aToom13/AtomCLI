# AtomCLI SDK

The JavaScript/TypeScript SDK lives in `js/`. Its public package is `@atomcli/sdk`, with exports under `@atomcli/sdk/v2`, `@atomcli/sdk/v2/client`, and `@atomcli/sdk/v2/server`.

Create a client with the generated SDK wrapper:

```ts
import { createAtomcliClient } from "@atomcli/sdk/v2"

const client = createAtomcliClient({
  baseUrl: "http://127.0.0.1:4096",
})
```

The server port is configurable and may fall back to an available port, so use the URL printed by `atomcli serve` when connecting to a running instance.

`js/openapi.json` is a temporary code-generation input and `js/src/v2/gen/` is generated source. After changing AtomBase server routes, regenerate them:

```sh
cd AtomBase
bun run dev generate > ../libs/sdk/js/openapi.json
cd ../libs/sdk/js
bun run build
```

Do not edit generated files manually.
