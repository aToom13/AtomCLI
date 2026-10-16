import { Bus } from "@/core/bus"
import { FileEvent } from "@/services/file/event"
import { Log } from "@/util/util/log"
import path from "path"
import z from "zod"

import * as Formatter from "./formatter"
import { Config } from "@/core/config/config"
import { mergeDeep } from "remeda"
import { Instance } from "@/services/project/instance"
import { EnvPolicy } from "@/core/env/policy"

export namespace Format {
  const log = Log.create({ service: "format" })

  export const Status = z
    .object({
      name: z.string(),
      extensions: z.string().array(),
      enabled: z.boolean(),
    })
    .meta({
      ref: "FormatterStatus",
    })
  export type Status = z.infer<typeof Status>

  const state = Instance.state(async () => {
    const enabled: Record<string, boolean> = {}
    const cfg = await Config.get()

    const formatters: Record<string, Formatter.Info> = {}
    if (cfg.formatter === false) {
      log.info("all formatters are disabled")
      return {
        enabled,
        formatters,
      }
    }

    for (const item of Object.values(Formatter)) {
      formatters[item.name] = item
    }
    for (const [name, item] of Object.entries(cfg.formatter ?? {})) {
      if (item.disabled) {
        delete formatters[name]
        continue
      }
      const result: Formatter.Info = mergeDeep(formatters[name] ?? {}, {
        command: [],
        extensions: [],
        ...item,
      })

      if (result.command.length === 0) continue

      result.enabled = async () => true
      result.name = name
      formatters[name] = result
    }

    return {
      enabled,
      formatters,
    }
  })

  async function isEnabled(item: Formatter.Info) {
    const s = await state()
    let status = s.enabled[item.name]
    if (status === undefined) {
      status = await item.enabled()
      s.enabled[item.name] = status
    }
    return status
  }

  async function getFormatter(ext: string) {
    const formatters = await state().then((x) => x.formatters)
    const result = []
    for (const item of Object.values(formatters)) {
      log.info("checking", { name: item.name, ext })
      if (!item.extensions.includes(ext)) continue
      if (!(await isEnabled(item))) continue
      log.info("enabled", { name: item.name, ext })
      result.push(item)
    }
    return result
  }

  export async function status() {
    const s = await state()
    const result: Status[] = []
    for (const formatter of Object.values(s.formatters)) {
      const enabled = await isEnabled(formatter)
      result.push({
        name: formatter.name,
        extensions: formatter.extensions,
        enabled,
      })
    }
    return result
  }

  async function formatFile(file: string) {
    log.info("formatting", { file })
    const ext = path.extname(file)

    for (const item of await getFormatter(ext)) {
      log.info("running", { command: item.command })
      try {
        const proc = Bun.spawn({
          cmd: item.command.map((x) => x.replace("$FILE", file)),
          cwd: Instance.directory,
          env: EnvPolicy.build({
            cwd: Instance.directory,
            scope: `formatter:${item.name}`,
            overrides: item.environment,
          }),
          stdout: "ignore",
          stderr: "ignore",
        })
        const exit = await proc.exited
        if (exit !== 0) throw new Error(`Formatter ${item.name} failed for ${file} (exit ${exit})`)
      } catch (error) {
        log.error("failed to format file", {
          error,
          command: item.command,
          file,
        })
        throw error
      }
    }
  }

  export function init() {
    log.info("init")
    Bus.subscribe(FileEvent.Edited, (payload) => formatFile(payload.properties.file))
    Bus.subscribe(FileEvent.Created, async (payload) => {
      for (const file of payload.properties.paths) await formatFile(file)
    })
  }
}
