import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Global } from "@/core/global"
import { Crypto } from "@/util/util/crypto"
import { Lock } from "@/util/util/lock"
import { Log } from "@/util/util/log"
import type { Provider } from "./provider"

const STORE_VERSION = 1
const VERIFIED_TTL_MS = 30 * 60 * 1000
const DEFAULT_FAILURE_RETRY_MS = 30 * 1000
const AUTH_FAILURE_RETRY_MS = 5 * 60 * 1000
const MAX_FAILURE_RETRY_MS = 5 * 60 * 1000
const MAX_ENTRIES = 1000
const LOCK_STALE_MS = 15 * 1000
const LOCK_WAIT_MS = 2 * 1000

export namespace ModelVerification {
  const log = Log.create({ service: "model-verification" })
  const filepath = path.join(Global.Path.data, "model-verification.json")
  const leasepath = filepath + ".lock"
  const inFlight = new Map<string, Promise<Info>>()
  const queues = new Map<string, Promise<Info>>()

  export const Capability = z.enum(["text", "tool", "image", "audio", "video", "pdf"])
  export type Capability = z.infer<typeof Capability>

  export const Status = z.enum(["unknown", "verified", "failed", "rate_limited", "inconclusive", "expired"])
  export type Status = z.infer<typeof Status>

  export const Reason = z.enum([
    "probe_failed",
    "empty_output",
    "stream_failed",
    "authentication",
    "rate_limited",
    "model_unavailable",
    "timeout",
    "output_limit",
  ])
  export type Reason = z.infer<typeof Reason>

  export const Info = z.object({
    key: z.string(),
    providerID: z.string(),
    modelID: z.string(),
    generation: z.number().int().nonnegative(),
    status: Status,
    checkedAt: z.number().optional(),
    verifiedUntil: z.number().optional(),
    retryAt: z.number().optional(),
    capabilities: z.record(z.string(), z.number()),
    reason: Reason.optional(),
  })
  export type Info = z.infer<typeof Info>

  const Store = z.object({
    version: z.literal(STORE_VERSION),
    entries: z.record(z.string(), Info),
  })
  type Store = z.infer<typeof Store>

  export type Attempt = {
    key: string
    providerID: string
    modelID: string
    generation: number
  }

  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical)
    if (!value || typeof value !== "object") {
      if (typeof value === "function") return "[function]"
      return value
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key, item]) => !key.startsWith("_") && item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    )
  }

  export async function paramsDigest(params: unknown) {
    return Crypto.fingerprint(JSON.stringify(canonical(params)))
  }

  export async function identity(
    model: Provider.Model,
    provider: Provider.Info,
    context?: { variant?: string; effectiveParams?: unknown; requiredContext?: number; requiredOutput?: number },
  ) {
    const { _routePolicy, _catalogCostKnown, ...modelOptions } = model.options ?? {}
    const connection = canonical({
      providerID: model.providerID,
      modelID: model.id,
      apiModelID: model.api.id,
      npm: model.api.npm,
      endpoint: provider.options.baseURL ?? model.api.url,
      providerKey: provider.key,
      providerOptions: provider.options,
      modelOptions,
      variant: context?.variant,
      variantOptions: context?.variant ? model.variants?.[context.variant] : undefined,
      effectiveParams: context?.effectiveParams,
      requiredContext: context?.requiredContext,
      requiredOutput: context?.requiredOutput,
      headers: model.headers,
      probeVersion: STORE_VERSION,
    })
    return Crypto.fingerprint(JSON.stringify(connection))
  }

  function emptyStore(): Store {
    return { version: STORE_VERSION, entries: {} }
  }

  async function readStore(): Promise<Store> {
    const raw = await Bun.file(filepath)
      .text()
      .catch(() => "")
    if (!raw.trim()) return emptyStore()
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      log.warn("model verification store contains invalid JSON; ignoring cached evidence")
      return emptyStore()
    }
    const parsed = Store.safeParse(json)
    if (!parsed.success) {
      log.warn("model verification store has an unsupported schema; ignoring cached evidence")
      return emptyStore()
    }
    return parsed.data
  }

  async function acquireLease(directory = leasepath) {
    await fs.mkdir(Global.Path.data, { recursive: true })
    const started = Date.now()
    while (true) {
      try {
        await fs.mkdir(directory)
        return {
          [Symbol.asyncDispose]: async () => {
            await fs.rmdir(directory).catch(() => {})
          },
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        const stat = await fs.stat(directory).catch(() => undefined)
        if (stat && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          const stale = `${directory}.stale.${process.pid}.${crypto.randomUUID()}`
          await fs.rename(directory, stale).catch(() => {})
          await fs.rmdir(stale).catch(() => {})
          continue
        }
        if (Date.now() - started >= LOCK_WAIT_MS) throw new Error("Timed out waiting for model verification lock")
        await Bun.sleep(25)
      }
    }
  }

  async function writeStore(store: Store) {
    const ordered = Object.values(store.entries)
      .sort((a, b) => (b.checkedAt ?? 0) - (a.checkedAt ?? 0))
      .slice(0, MAX_ENTRIES)
    const next: Store = {
      version: STORE_VERSION,
      entries: Object.fromEntries(ordered.map((entry) => [entry.key, entry])),
    }
    const temporary = `${filepath}.${process.pid}.${crypto.randomUUID()}.tmp`
    await Bun.write(temporary, JSON.stringify(next, null, 2))
    await fs.rename(temporary, filepath).catch(async (error) => {
      await fs.unlink(temporary).catch(() => {})
      throw error
    })
  }

  async function update(fn: (store: Store) => void) {
    using processLock = await Lock.write(filepath)
    await using lease = await acquireLease()
    const store = await readStore()
    fn(store)
    await writeStore(store)
  }

  function current(info: Info | undefined, now = Date.now()): Info | undefined {
    if (!info) return
    if (info.status === "verified" && (info.verifiedUntil ?? 0) <= now) return { ...info, status: "expired" }
    if (
      (info.status === "failed" || info.status === "rate_limited" || info.status === "inconclusive") &&
      (info.retryAt ?? 0) <= now
    ) {
      return { ...info, status: "expired" }
    }
    return info
  }

  export async function get(key: string, now = Date.now()) {
    using _ = await Lock.read(filepath)
    return current((await readStore()).entries[key], now)
  }

  export function isVerified(info: Info | undefined, capability: Capability = "text", now = Date.now()) {
    const active = current(info, now)
    return active?.status === "verified" && (active.capabilities[capability] ?? 0) > now
  }

  export async function begin(input: { key: string; providerID: string; modelID: string }): Promise<Attempt> {
    let generation = 0
    await update((store) => {
      const previous = store.entries[input.key]
      generation = (previous?.generation ?? 0) + 1
      store.entries[input.key] = {
        key: input.key,
        providerID: input.providerID,
        modelID: input.modelID,
        generation,
        status: "unknown",
        capabilities: previous?.capabilities ?? {},
      }
    })
    return { ...input, generation }
  }

  export async function verified(
    attempt: Attempt,
    capabilities: Capability[] = ["text"],
    options?: { now?: number; ttlMs?: number },
  ) {
    const now = options?.now ?? Date.now()
    const verifiedUntil = now + (options?.ttlMs ?? VERIFIED_TTL_MS)
    await update((store) => {
      const current = store.entries[attempt.key]
      if (!current || current.generation !== attempt.generation) return
      store.entries[attempt.key] = {
        ...current,
        status: "verified",
        checkedAt: now,
        verifiedUntil,
        retryAt: undefined,
        reason: undefined,
        capabilities: {
          ...current.capabilities,
          ...Object.fromEntries(capabilities.map((capability) => [capability, verifiedUntil])),
        },
      }
    })
    return get(attempt.key, now)
  }

  export async function failed(
    attempt: Attempt,
    reason: Reason,
    options?: { now?: number; retryAt?: number; consecutiveFailures?: number },
  ) {
    const now = options?.now ?? Date.now()
    const failures = Math.max(1, options?.consecutiveFailures ?? 1)
    const delay =
      reason === "authentication" || reason === "model_unavailable"
        ? AUTH_FAILURE_RETRY_MS
        : Math.min(DEFAULT_FAILURE_RETRY_MS * 2 ** (failures - 1), MAX_FAILURE_RETRY_MS)
    const retryAt = options?.retryAt ?? now + delay
    await update((store) => {
      const current = store.entries[attempt.key]
      if (!current || current.generation !== attempt.generation) return
      store.entries[attempt.key] = {
        ...current,
        status:
          reason === "rate_limited"
            ? "rate_limited"
            : ["timeout", "output_limit"].includes(reason)
              ? "inconclusive"
              : "failed",
        checkedAt: now,
        retryAt,
        verifiedUntil: undefined,
        reason,
      }
    })
    return get(attempt.key, now)
  }

  export async function probe(
    input: { key: string; providerID: string; modelID: string; capability?: Capability; force?: boolean },
    run: () => Promise<{ capabilities: Capability[] }>,
  ) {
    const capability = input.capability ?? "text"
    const flightKey = `${input.key}:${capability}`
    const active = inFlight.get(flightKey)
    if (active) return active
    const previous = queues.get(input.key)
    const pending = (async (): Promise<Info> => {
      if (previous) await previous.catch(() => {})
      let existing = await get(input.key)
      if (!input.force && isVerified(existing, capability)) return existing!
      if (
        !input.force &&
        (existing?.status === "failed" || existing?.status === "rate_limited" || existing?.status === "inconclusive")
      )
        return existing

      // The filesystem lease extends single-flight across AtomCLI processes.
      // It is identity-wide (rather than capability-wide) so concurrent text
      // and tool probes cannot race their generation counters.
      await using probeLease = await acquireLease(`${filepath}.probe.${input.key}.lock`)
      existing = await get(input.key)
      if (!input.force && isVerified(existing, capability)) return existing!
      if (
        !input.force &&
        (existing?.status === "failed" || existing?.status === "rate_limited" || existing?.status === "inconclusive")
      )
        return existing
      const attempt = await begin(input)
      try {
        const result = await run()
        return (await verified(attempt, result.capabilities))!
      } catch (error) {
        // A local execution-budget rejection says nothing about model health.
        // Propagate it without poisoning durable verification evidence.
        if (error instanceof Error && error.name === "ExecutionBudgetExceededError") {
          await update((store) => {
            const current = store.entries[attempt.key]
            if (!current || current.generation !== attempt.generation) return
            if (existing) store.entries[attempt.key] = existing
            else delete store.entries[attempt.key]
          })
          throw error
        }
        log.warn("model verification probe failed", {
          providerID: input.providerID,
          modelID: input.modelID,
          error: error instanceof Error ? error.name : "UnknownError",
        })
        return (await failed(attempt, classify(error)))!
      }
    })()
    inFlight.set(flightKey, pending)
    queues.set(input.key, pending)
    try {
      return await pending
    } finally {
      if (inFlight.get(flightKey) === pending) inFlight.delete(flightKey)
      if (queues.get(input.key) === pending) queues.delete(input.key)
    }
  }

  export function classify(error: unknown): Reason {
    const value = error instanceof Error ? `${error.name} ${error.message}` : String(error)
    if (/429|rate.?limit|too many requests/i.test(value)) return "rate_limited"
    if (/401|403|unauthori[sz]ed|forbidden|api.?key|authentication/i.test(value)) return "authentication"
    if (/model.?not.?found|model.+unavailable/i.test(value)) return "model_unavailable"
    if (/timed?\s*out|timeout/i.test(value)) return "timeout"
    if (/output.?limit|length.?limit|max.?output/i.test(value)) return "output_limit"
    if (/empty|whitespace/i.test(value)) return "empty_output"
    if (/stream/i.test(value)) return "stream_failed"
    return "probe_failed"
  }

  export async function observe(
    model: Provider.Model,
    provider: Provider.Info,
    capabilities: Capability[],
    error?: unknown,
    context?: { variant?: string; effectiveParams?: unknown },
  ) {
    try {
      const key = await identity(model, provider, context)
      const attempt = await begin({ key, providerID: model.providerID, modelID: model.id })
      if (error) return failed(attempt, classify(error))
      return verified(attempt, capabilities)
    } catch (recordError) {
      log.warn("failed to persist observed model evidence", {
        providerID: model.providerID,
        modelID: model.id,
        error: recordError instanceof Error ? recordError.name : "UnknownError",
      })
    }
  }

  export const _internals = {
    current,
    canonical,
    filepath,
  }
}
