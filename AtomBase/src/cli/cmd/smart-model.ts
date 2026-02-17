import { cmd } from "./cmd"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"

export const SmartModelCommand = cmd({
  command: "smart-model [action]",
  describe: "manage smart model routing (auto-select best model per task)",
  builder: {
    action: {
      type: "string",
      choices: ["on", "off", "toggle", "status"],
      describe: "Action to perform: on, off, toggle, or status (default: status)",
      default: "status",
    },
  },
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Smart Model Routing")

        // Get current config
        const config = await Config.get()
        const currentValue = config?.experimental?.smart_model_routing === true

        let newValue: boolean

        switch (args.action) {
          case "on":
            newValue = true
            break
          case "off":
            newValue = false
            break
          case "toggle":
            newValue = !currentValue
            break
          case "status":
          default:
            prompts.log.info(`Current status: ${currentValue ? "Enabled 🧠" : "Disabled 🛡️"}`)
            prompts.log.info("Smart model routing auto-selects the best model for each task category.")
            prompts.outro("Use 'atomcli smart-model on|off|toggle' to change")
            return
        }

        // Update config if changed
        if (newValue !== currentValue) {
          await Config.update({
            experimental: {
              smart_model_routing: newValue,
            },
          })

          prompts.log.success(`Smart Model Routing: ${newValue ? "Enabled 🧠" : "Disabled 🛡️"}`)
        } else {
          prompts.log.info(`Already ${newValue ? "enabled 🧠" : "disabled 🛡️"}`)
        }

        prompts.outro("Done")
      },
    })
  },
})
