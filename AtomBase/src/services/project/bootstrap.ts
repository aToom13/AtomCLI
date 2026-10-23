import { Plugin } from "@/integrations/plugin"
import { Share } from "@/util/share/share"
import { Format } from "@/interfaces/format"
import { LSP } from "@/integrations/lsp"
import { FileWatcher } from "../file/watcher"
import { File } from "../file"
import { Project } from "./project"
import { Bus } from "@/core/bus"
import { Command } from "@/interfaces/command"
import { Instance } from "./instance"
import { Vcs } from "./vcs"
import { Log } from "@/util/util/log"
import { ShareNext } from "@/util/share/share-next"
import { SessionSummary } from "@/core/session/summary"
import { DataMaintenance } from "@/core/storage/maintenance"

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  await Plugin.init()
  Share.init()
  await ShareNext.init()
  // HIST-04: reschedule summary intents left behind by a crashed process.
  await SessionSummary.recoverPending().catch((error) =>
    Log.Default.warn("failed to reschedule pending session summaries", {
      error: (error as Error).message,
    }),
  )
  Format.init()
  await LSP.init()
  await FileWatcher.init()
  await File.init()
  await Vcs.init()
  DataMaintenance.init()

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      await Project.setInitialized(Instance.project.id)
    }
  })
}
