import "../preload"
import { describe, expect, test } from "bun:test"
import path from "path"
import { CompanionTransfer } from "@/services/companion/transfer"
import { Instance } from "@/services/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("companion transfer", () => {
  test("routes text uploads through AtomCLI file reading and keeps archives tool-addressable", () => {
    expect(CompanionTransfer._internals.isTextUpload("main.dart", "application/octet-stream")).toBe(true)
    expect(CompanionTransfer._internals.isTextUpload("notes.md", "text/markdown")).toBe(true)
    expect(CompanionTransfer._internals.isTextUpload("source.zip", "application/zip")).toBe(false)
    expect(CompanionTransfer._internals.isDirectModelInput("image/png")).toBe(true)
    expect(CompanionTransfer._internals.isDirectModelInput("application/pdf")).toBe(true)
    expect(CompanionTransfer._internals.isDirectModelInput("application/zip")).toBe(false)
    expect(CompanionTransfer._internals.directInputModality("image/png")).toBe("image")
    expect(CompanionTransfer._internals.directInputModality("application/pdf")).toBe("pdf")
    expect(CompanionTransfer._internals.directInputModality("application/zip")).toBeUndefined()
  })

  test("shares token-protected files with mobile metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    const filePath = path.join(tmp.path, "phone-preview.png")
    await Bun.write(filePath, new Uint8Array([137, 80, 78, 71]))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const shared = await CompanionTransfer.shareFile({
          filePath,
          title: "Phone preview",
          sessionID: "session_test",
        })
        expect(shared).toMatchObject({
          kind: "image",
          direction: "pc_to_mobile",
          title: "Phone preview",
          name: "phone-preview.png",
          sessionID: "session_test",
        })
        const url = new URL(shared.downloadPath, "http://localhost")
        expect(CompanionTransfer.artifact(shared.id, "wrong-token")).toBeUndefined()
        expect(CompanionTransfer.artifact(shared.id, url.searchParams.get("token")!)).toMatchObject({
          filePath,
        })
      },
    })
  })

  test("starts, reports and stops a managed preview", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const preview = await CompanionTransfer.startPreview({
          command:
            "bun -e 'Bun.serve({port:Number(process.env.PORT),hostname:process.env.HOST,fetch(){return new Response(\"ok\")}})'",
          port: 43127,
          title: "Test preview",
        })
        expect(preview.status).toBe("running")
        expect(preview.endpoints.some((endpoint) => endpoint.endsWith(":43127"))).toBe(true)
        expect(await fetch("http://127.0.0.1:43127").then((response) => response.text())).toBe("ok")
        expect(CompanionTransfer.stopPreview(preview.id).status).toBe("stopped")
      },
    })
  })

  test("does not confuse two previews that use the same port", async () => {
    await using project = await tmpdir({ git: true })
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const probe = Bun.serve({ port: 0, fetch: () => new Response("probe") })
        const port = probe.port
        await probe.stop(true)
        const first = await CompanionTransfer.startPreview({
          command: `bun -e 'Bun.serve({ port: ${port}, fetch: () => new Response("first") })'`,
          port,
          title: "First",
        })
        expect(first.status).toBe("running")
        await expect(
          CompanionTransfer.startPreview({
            command: `bun -e 'Bun.serve({ port: ${port}, fetch: () => new Response("second") })'`,
            port,
            title: "Second",
          }),
        ).rejects.toThrow(`A companion preview is already using port ${port}`)
        CompanionTransfer.stopPreview(first.id)
      },
    })
  })

  test("rejects an upload before reading a body with a mismatched length", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const upload = await CompanionTransfer.createUpload({
          filename: "screen.png",
          mime: "image/png",
          size: 4,
          sessionID: "session_upload_length",
          directory: tmp.path,
          deviceName: "Android test",
        })
        const url = new URL(upload.uploadPath, "http://localhost")
        await expect(
          CompanionTransfer.acceptUpload({
            id: upload.id,
            token: url.searchParams.get("token")!,
            contentLength: 3,
            body: new Blob([new Uint8Array([1, 2, 3])]).stream(),
          }),
        ).rejects.toThrow("Uploaded file size did not match")
      },
    })
  })

  test("stores mobile images before prompting and falls back to a machine path", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const upload = await CompanionTransfer.createUpload({
          filename: "camera.png",
          mime: "image/png",
          size: 4,
          sessionID: "session_staged_image",
          directory: tmp.path,
          deviceName: "Android test",
        })
        const url = new URL(upload.uploadPath, "http://localhost")
        const accepted = await CompanionTransfer.acceptUpload({
          id: upload.id,
          token: url.searchParams.get("token")!,
          contentLength: 4,
          body: new Blob([new Uint8Array([137, 80, 78, 71])]).stream(),
        })

        expect(await Bun.file(accepted.filePath).exists()).toBe(true)
        const parts = await CompanionTransfer.promptParts({
          artifactIDs: [accepted.artifact.id],
          sessionID: "session_staged_image",
        })
        expect(parts).toHaveLength(1)
        expect(parts[0]).toMatchObject({ type: "text" })
        if (parts[0]?.type !== "text") throw new Error("Expected a path-only text prompt")
        expect(parts[0].text).toContain(accepted.filePath)
      },
    })
  })
})
