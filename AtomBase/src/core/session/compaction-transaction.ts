import z from "zod"
import { Log } from "@/util/util/log"
import { Storage } from "@/core/storage/storage"

const log = Log.create({ service: "session.compaction.transaction" })

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
    parentID: z.string().optional(),
    summaryMessageID: z.string().optional(),
    error: z.string().optional(),
  })
  export type Info = z.infer<typeof Info>

  export async function start(
    sessionID: string,
    sourceTokens: number,
    retry: number,
    link?: { parentID: string; summaryMessageID: string },
  ) {
    const value = Info.parse({
      id: `compaction-${crypto.randomUUID()}`,
      sessionID,
      status: "running",
      startedAt: Date.now(),
      sourceTokens,
      retry,
      ...link,
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
      // The process crashed after writing the summary message but before
      // committing the transaction, leaving an orphan summary behind. Remove
      // the linked summary message and its parts so it cannot leak into model
      // context. Never touch value.parentID — that is the real user message.
      if (value.summaryMessageID) {
        for (const part of await Storage.list(["part", value.summaryMessageID])) await Storage.remove(part)
        await Storage.remove(["message", sessionID, value.summaryMessageID])
        log.info("removed orphan summary message", {
          sessionID,
          summaryMessageID: value.summaryMessageID,
          transaction: value.id,
        })
      }
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

  export async function isCommittedSummary(sessionID: string, summaryMessageID: string) {
    const keys = await Storage.list(["compaction_transaction", sessionID])
    let linked = false
    for (const key of keys) {
      const value = Info.parse(await Storage.read(key))
      if (value.summaryMessageID !== summaryMessageID) continue
      linked = true
      if (value.status === "completed") return true
    }
    // Fail-closed: a summary message without a completed linked transaction is
    // never treated as committed. Missing or unfinished records mean the
    // summary was never durably committed (or is an orphan pending recovery),
    // so it must stay excluded from the model context window.
    if (!linked)
      log.warn("summary message has no linked compaction transaction; treating as uncommitted", {
        sessionID,
        summaryMessageID,
      })
    return false
  }
}
