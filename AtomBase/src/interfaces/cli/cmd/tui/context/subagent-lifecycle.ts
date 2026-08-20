export namespace SubAgentLifecycle {
  export interface SessionClient {
    abort(input: { sessionID: string }): Promise<unknown>
    delete(input: { sessionID: string }): Promise<{ error?: unknown } | unknown>
  }

  /** Abort active work, then delete the child session so hydration cannot restore it. */
  export async function dismiss(client: SessionClient, sessionID: string) {
    await client.abort({ sessionID }).catch(() => {})
    const response = await client.delete({ sessionID })
    if (response && typeof response === "object" && "error" in response && response.error) {
      throw new Error(`Failed to delete sub-agent session: ${String(response.error)}`)
    }
  }
}
