import { SlashCommand } from "./slash-command"
import type { PromptInfo } from "./history"
import type { useLocal } from "@tui/context/local"
import type { useSDK } from "@tui/context/sdk"
import type { useSync } from "@tui/context/sync"
import type { useToast } from "@tui/ui/toast"
import { DialogDirectoryPicker } from "@tui/component/dialog-directory-picker"
import { DialogSkillList } from "@tui/component/dialog-skill-list"
import { DialogExecutionRecovery } from "@tui/component/dialog-execution-recovery"
import { createComponent } from "solid-js"
import { validateDirectory } from "@tui/component/directory-picker"
import type { DialogContext } from "@tui/ui/dialog"

type SyncContext = ReturnType<typeof useSync>
type SDKContext = ReturnType<typeof useSDK>
type LocalContext = ReturnType<typeof useLocal>

type CommandContext = {
  sessionID?: string
  clearPrompt: () => void
  setPrompt: (value: PromptInfo) => void
  submit: (hiddenInstruction?: string) => Promise<void>
  updateMode: (mode: "autonomous" | "safe") => Promise<void>
  toast: ReturnType<typeof useToast>
  sync: SyncContext
  sdk: SDKContext
  local: LocalContext
  command: { trigger: (action: string, value?: string) => void }
  dialog: DialogContext
  exit: () => Promise<void>
}

export async function executePromptCommand(context: CommandContext, info: SlashCommand.Info, argumentsText = "") {
  if (info.action === "workflow.prompt") {
    const instruction = SlashCommand.renderWorkflow(info, argumentsText)
    if (!instruction) {
      context.toast.show({
        title: `/${info.name}`,
        message: `Required argument: ${info.workflow?.argumentHint ?? "description"}`,
        variant: "warning",
      })
      return
    }
    await context.submit(instruction)
    return
  }
  context.clearPrompt()
  switch (info.action) {
    case "app.exit":
      await context.exit()
      return
    case "group.help":
      context.toast.show({
        title: `/${info.name}`,
        message: `Available: ${info.children?.map((command) => command.name).join(", ") ?? "none"}`,
        variant: "info",
      })
      return
    case "mode.autonomous":
      await context.updateMode("autonomous")
      return
    case "mode.safe":
      await context.updateMode("safe")
      return
    case "smart-model.toggle": {
      const current = context.sync.data.config.experimental?.smart_model_routing === true
      const requested = argumentsText.toLowerCase()
      const enabled = requested === "on" ? true : requested === "off" ? false : !current
      try {
        await context.sdk.client.config.update(
          { experimental: { smart_model_routing: enabled } },
          { throwOnError: true },
        )
        context.sync.set("config", "experimental", {
          ...context.sync.data.config.experimental,
          smart_model_routing: enabled,
        })
        context.toast.show({ title: "Smart model routing", message: enabled ? "Enabled" : "Disabled", variant: "info" })
      } catch (error) {
        context.toast.show({
          title: "Smart model routing",
          message: error instanceof Error ? error.message : "Could not update model routing",
          variant: "error",
        })
      }
      return
    }
    case "adaptive-routing.set": {
      const mode = (["off", "ask", "auto"] as const).find((item) => item === argumentsText.toLowerCase())
      if (!mode) {
        context.toast.show({ title: "Adaptive routing", message: "Use off, ask, or auto", variant: "warning" })
        return
      }
      try {
        const current = context.sync.data.config.adaptive_routing ?? {}
        await context.sdk.client.config.update({ adaptive_routing: { ...current, mode } }, { throwOnError: true })
        context.sync.set("config", "adaptive_routing", { ...current, mode })
        context.toast.show({ title: "Adaptive routing", message: `Mode: ${mode}`, variant: "info" })
      } catch (error) {
        context.toast.show({
          title: "Adaptive routing",
          message: error instanceof Error ? error.message : "Could not update adaptive routing",
          variant: "error",
        })
      }
      return
    }
    case "session.path": {
      const open = async (directory: string) => {
        try {
          await context.sdk.setDirectory(validateDirectory(directory))
          context.toast.show({ title: "Working directory", message: directory, variant: "success" })
        } catch (error) {
          context.toast.show({
            title: "Working directory",
            message: error instanceof Error ? error.message : String(error),
            variant: "error",
          })
        }
      }
      if (argumentsText.trim()) await open(argumentsText.trim())
      else
        context.dialog.replace(() =>
          DialogDirectoryPicker({ initial: context.sync.data.path.directory, onSelect: open }),
        )
      return
    }
    case "skill.list": {
      try {
        const response = await context.sdk.client.skill.list({}, { throwOnError: true })
        context.dialog.replace(() =>
          createComponent(DialogSkillList, {
            skills: response.data.skills,
            onLoad: (name: string) => context.setPrompt({ input: `@${name} `, parts: [] }),
          }),
        )
      } catch (error) {
        context.toast.show({
          title: "Load skills",
          message: error instanceof Error ? error.message : String(error),
          variant: "error",
        })
      }
      return
    }
    case "session.recover": {
      const sessionID = context.sessionID
      if (!sessionID) return
      try {
        await context.sync.session.refreshExecutions(sessionID)
        context.dialog.replace(() => createComponent(DialogExecutionRecovery, { sessionID }))
      } catch (error) {
        context.toast.show({
          title: "Execution recovery",
          message: error instanceof Error ? error.message : String(error),
          variant: "error",
        })
      }
      return
    }
    case "think.set": {
      const level = argumentsText.toLowerCase() || undefined
      const valid = ["none", "minimal", "low", "medium", "high", "max", "xhigh", "default", "off"]
      if (!level) {
        const current = context.local.model.variant.current()
        context.toast.show({
          title: "Thinking level",
          message: current ? `Current level: ${current.toUpperCase()}` : "Current level: DEFAULT",
          variant: "info",
        })
        return
      }
      const supported = context.local.model.variant.list()
      if (!valid.includes(level) || (level !== "off" && !supported.includes(level))) {
        context.toast.show({
          title: "Thinking level",
          message:
            supported.length === 0
              ? "The selected model does not expose configurable thinking levels"
              : `Level '${level}' is not supported. Available: ${[...supported, "off"].join(", ")}`,
          variant: "warning",
        })
        return
      }
      context.local.model.variant.set(level === "off" ? undefined : level, { manual: true })
      context.toast.show({
        title: "Thinking level",
        message: level === "off" ? "Reset to the model default" : `Set to ${level.toUpperCase()}`,
        variant: "info",
      })
      return
    }
    case "prompt.editor":
      context.command.trigger(info.action, "prompt")
      return
    default:
      context.command.trigger(info.action)
  }
}
