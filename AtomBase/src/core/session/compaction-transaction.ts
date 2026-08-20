import z from "zod"
import { Storage } from "@/core/storage/storage"

export namespace CompactionTransaction {
  export const Info = z.object({
    id: z.string(),
    sessionID: z.string(),
    status: z.enum(["running", "completed", "rejected", "failed", "recovered"]),
    startedAt: z.number().int(),
    completedAt: z.number().int().optional(),
    sourceTokens: z.number().int().nonnegative(),
    summaryTokens: z.number().int().nonnegative().optional(),
    ratio: z.number().nonnegative().optional(),
    retry: z.number().int().nonnegative(),
    error: z.string().optional(),
  })
  export type Info = z.infer<typeof Info>

  export async function start(sessionID: string, sourceTokens: number, retry: number) {
    const value = Info.parse({
      id: `compaction-${crypto.randomUUID()}`,
      sessionID,
      status: "running",
      startedAt: Date.now(),
      sourceTokens,
      retry,
    })
    await Storage.write(["compaction_transaction", sessionID, value.id], value)
    return value
  }

  export async function finish(input: Info, summaryTokens: number, accepted: boolean) {
    const value = Info.parse({
      ...input,
      status: accepted ? "completed" : "rejected",
      completedAt: Date.now(),
      summaryTokens,
      ratio: input.sourceTokens === 0 ? 0 : summaryTokens / input.sourceTokens,
    })
    await Storage.write(["compaction_transaction", input.sessionID, input.id], value)
    return value
  }

  export async function fail(input: Info, error: unknown) {
    await Storage.write(["compaction_transaction", input.sessionID, input.id], {
      ...input,
      status: "failed",
      completedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error),
    } satisfies Info)
  }

  export async function recover(sessionID: string) {
    const keys = await Storage.list(["compaction_transaction", sessionID])
    let recovered = 0
    for (const key of keys) {
      const value = Info.parse(await Storage.read(key))
      if (value.status !== "running") continue
      await Storage.write(key, {
        ...value,
        status: "recovered",
        completedAt: Date.now(),
        error: "Compaction process stopped before committing a summary",
      } satisfies Info)
      recovered++
    }
    return recovered
  }
}
