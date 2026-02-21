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

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  await Plugin.init()
  Share.init()
  ShareNext.init()
  Format.init()
  await LSP.init()
  FileWatcher.init()
  File.init()
  Vcs.init()

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      await Project.setInitialized(Instance.project.id)
    }
  })
}
