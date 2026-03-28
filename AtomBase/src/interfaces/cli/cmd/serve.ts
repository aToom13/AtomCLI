import { Server } from "@/server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { CompanionAuth, MobileBridge, CompanionDiscovery, NtfyService } from "@atomcli/companion"
import { GlobalBus } from "@/core/bus/global"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless atomcli server",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    console.log(`atomcli server listening on http://${server.hostname}:${server.port}`)

    // Always load paired devices and initialize bridge to allow auto-reconnect
    CompanionAuth.loadDevices()
    MobileBridge.initialize(GlobalBus)

    // Configure optional ntfy.sh webhook (set ATOMCLI_NTFY_URL to enable)
    NtfyService.configure(process.env.ATOMCLI_NTFY_URL)

    if (opts.companion) {
      // Issue a pairing token and display QR code
      const pairingToken = CompanionAuth.issueToken()
      await CompanionDiscovery.printCompanionInfo(server.port, pairingToken)
    }

    await new Promise(() => { })
    await server.stop()
  },
})
