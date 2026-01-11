export * from "./client.js"
export * from "./server.js"

import { createAtomcliClient } from "./client.js"
import { createAtomcliServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createAtomcli(options?: ServerOptions) {
  const server = await createAtomcliServer({
    ...options,
  })

  const client = createAtomcliClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
