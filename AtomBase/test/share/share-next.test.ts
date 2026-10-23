import "../preload"
import { expect, spyOn, test } from "bun:test"
import { Bus } from "@/core/bus"
import { MessageV2 } from "@/core/session/message-v2"
import { Storage } from "@/core/storage/storage"
import { Instance } from "@/services/project/instance"
import { Provider } from "@/integrations/provider/provider"
import { ShareNext } from "@/util/share/share-next"
import { tmpdir } from "../fixture/fixture"

test("unshared user messages do not resolve unavailable models; corrupt share records remain errors", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await ShareNext.init()
      const info: MessageV2.User = {
        id: "msg_share_regression",
        sessionID: "ses_share_regression",
        role: "user",
        agent: "build",
        model: { providerID: "test", modelID: "unavailable" },
        time: { created: Date.now() },
      }
      const model = spyOn(Provider, "getModel").mockRejectedValue(new Error("unavailable model"))
      try {
        await expect(Bus.publish(MessageV2.Event.Updated, { info })).resolves.toBeDefined()
        expect(model).not.toHaveBeenCalled()
        const read = spyOn(Storage, "read").mockRejectedValue(new SyntaxError("corrupt share JSON"))
        try {
          await expect(Bus.publish(MessageV2.Event.Updated, { info })).rejects.toThrow("corrupt share JSON")
          expect(model).not.toHaveBeenCalled()
        } finally {
          read.mockRestore()
        }
        await Storage.write(["session_share", info.sessionID], {
          id: "fake-share",
          secret: "test-only-not-a-real-share-secret",
          url: "https://example.invalid/share/fake",
        })
        await expect(Bus.publish(MessageV2.Event.Updated, { info })).rejects.toThrow("unavailable model")
        expect(model).toHaveBeenCalledTimes(1)
        await Storage.remove(["session_share", info.sessionID])
      } finally {
        model.mockRestore()
        await Instance.dispose()
      }
    },
  })
})
