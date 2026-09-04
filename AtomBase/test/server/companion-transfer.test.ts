import "../preload"
import { describe, expect, test } from "bun:test"
import { createHash } from "crypto"
import path from "path"
import { CompanionTransfer } from "@/services/companion/transfer"
import { Server } from "@/server/server"
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
        const record = CompanionTransfer.artifact(shared.id, url.searchParams.get("token")!)
        expect(record?.filePath).not.toBe(filePath)
        expect(record?.managedFile).toBe(true)
        expect(await Bun.file(record!.filePath).arrayBuffer()).toEqual(await Bun.file(filePath).arrayBuffer())
        expect(CompanionTransfer.deleteArtifact(shared.id)).toBe(true)
        expect(CompanionTransfer.artifact(shared.id, url.searchParams.get("token")!)).toBeUndefined()
        expect(await Bun.file(filePath).exists()).toBe(true)
      },
    })
  })

  test("serves immutable byte ranges with a checksum identity", async () => {
    await using tmp = await tmpdir({ git: true })
    const source = path.join(tmp.path, "range.bin")
    await Bun.write(source, new Uint8Array([0, 1, 2, 3, 4, 5]))
    const shared = await Instance.provide({
      directory: tmp.path,
      fn: () => CompanionTransfer.shareFile({ filePath: source }),
    })
    await Bun.write(source, new Uint8Array([9, 9, 9, 9, 9, 9]))
    const server = Server.listenCompanion({ port: 0, directory: tmp.path })
    try {
      const url = new URL(shared.downloadPath, `http://127.0.0.1:${server.port}`)
      const partial = await fetch(url, { headers: { range: "bytes=2-4" } })
      expect(partial.status).toBe(206)
      expect(partial.headers.get("content-range")).toBe("bytes 2-4/6")
      expect(partial.headers.get("x-content-sha256")).toBe(shared.sha256)
      expect(new Uint8Array(await partial.arrayBuffer())).toEqual(new Uint8Array([2, 3, 4]))

      const changedIdentity = await fetch(url, {
        headers: { Range: "bytes=2-", "If-Range": '"sha256-wrong"' },
      })
      expect(changedIdentity.status).toBe(200)
      expect(new Uint8Array(await changedIdentity.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 3, 4, 5]))
    } finally {
      await server.stop(true)
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          CompanionTransfer.deleteArtifact(shared.id)
        },
      })
    }
  })

  test("exposes resumable upload status and chunks over HTTP", async () => {
    await using tmp = await tmpdir({ git: true })
    const bytes = new Uint8Array([10, 11, 12, 13])
    const sha256 = createHash("sha256").update(bytes).digest("hex")
    const upload = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        CompanionTransfer.createUpload({
          filename: "http-resume.bin",
          mime: "application/octet-stream",
          size: bytes.length,
          sha256,
          sessionID: "session_http_resume",
          directory: tmp.path,
          deviceName: "Android test",
        }),
    })
    const server = Server.listenCompanion({ port: 0, directory: tmp.path })
    try {
      const url = new URL(upload.uploadPath, `http://127.0.0.1:${server.port}`)
      const initial = await fetch(url)
      expect(initial.status).toBe(200)
      expect(await initial.json()).toMatchObject({ offset: 0, size: 4, chunk_size: 4 * 1024 * 1024 })

      const first = bytes.slice(0, 2)
      const partial = await fetch(url, {
        method: "PATCH",
        headers: {
          "upload-offset": "0",
          "x-chunk-sha256": createHash("sha256").update(first).digest("hex"),
        },
        body: first,
      })
      expect(partial.status).toBe(200)
      expect(await partial.json()).toMatchObject({ status: "partial", offset: 2, size: 4 })
      expect(await (await fetch(url)).json()).toMatchObject({ offset: 2, size: 4 })

      const last = bytes.slice(2)
      const complete = await fetch(url, {
        method: "PATCH",
        headers: {
          "upload-offset": "2",
          "x-chunk-sha256": createHash("sha256").update(last).digest("hex"),
        },
        body: last,
      })
      expect(complete.status).toBe(200)
      expect(await complete.json()).toMatchObject({
        status: "complete",
        offset: 4,
        artifact: { sha256, direction: "mobile_to_pc" },
      })
      expect((await fetch(url, { method: "HEAD" })).status).toBe(404)
    } finally {
      await server.stop(true)
    }
  })

  test("starts, reports and stops a managed preview", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const probe = Bun.serve({ port: 0, fetch: () => new Response("probe") })
        const targetPort = probe.port
        await probe.stop(true)
        const preview = await CompanionTransfer.startPreview({
          command:
            "bun -e 'Bun.serve({port:Number(process.env.PORT),hostname:process.env.HOST,fetch(){return new Response(\"ok\")}})'",
          port: targetPort,
          title: "Test preview",
        })
        expect(preview.status).toBe("running")
        const endpoint = new URL(preview.endpoints[0])
        expect(endpoint.port).not.toBe(String(targetPort))
        expect(endpoint.searchParams.get("atomcli_token")).toBeTruthy()
        endpoint.hostname = "127.0.0.1"
        const unauthorized = new URL(endpoint)
        unauthorized.search = ""
        expect((await fetch(unauthorized)).status).toBe(401)
        const bootstrap = await fetch(endpoint, { redirect: "manual" })
        expect(bootstrap.status).toBe(302)
        const cookie = bootstrap.headers.get("set-cookie")!.split(";", 1)[0]
        const authorized = await fetch(new URL(bootstrap.headers.get("location")!), {
          headers: { cookie },
        })
        expect(await authorized.text()).toBe("ok")
        const asset = new URL(bootstrap.headers.get("location")!)
        asset.pathname = "/assets/app.js"
        asset.search = "?version=1"
        expect(await fetch(asset, { headers: { cookie } }).then((response) => response.text())).toBe("ok")
        const refreshed = await CompanionTransfer.previewAccess(preview.id)
        expect(refreshed.endpoints[0]).not.toBe(preview.endpoints[0])
        expect(await fetch(`http://127.0.0.1:${targetPort}`).then((response) => response.text())).toBe("ok")
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

  test("resumes checksummed uploads from the authoritative server offset", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bytes = new Uint8Array([1, 2, 3, 4, 5, 6])
        const sha256 = createHash("sha256").update(bytes).digest("hex")
        const upload = await CompanionTransfer.createUpload({
          filename: "resume.bin",
          mime: "application/octet-stream",
          size: bytes.length,
          sha256,
          sessionID: "session_resume",
          directory: tmp.path,
          deviceName: "Android test",
        })
        const url = new URL(upload.uploadPath, "http://localhost")
        const token = url.searchParams.get("token")!
        expect(CompanionTransfer.uploadStatus(upload.id, token)).toMatchObject({ offset: 0, size: 6 })

        const first = bytes.slice(0, 3)
        const partial = await CompanionTransfer.acceptUploadChunk({
          id: upload.id,
          token,
          offset: 0,
          contentLength: first.length,
          chunkSha256: createHash("sha256").update(first).digest("hex"),
          body: new Blob([first]).stream(),
        })
        expect(partial).toMatchObject({ status: "partial", offset: 3, size: 6 })
        expect(CompanionTransfer.uploadStatus(upload.id, token)?.offset).toBe(3)
        await expect(
          CompanionTransfer.acceptUploadChunk({
            id: upload.id,
            token,
            offset: 0,
            contentLength: 3,
            body: new Blob([bytes.slice(3)]).stream(),
          }),
        ).rejects.toThrow("expected 3")

        const last = bytes.slice(3)
        const complete = await CompanionTransfer.acceptUploadChunk({
          id: upload.id,
          token,
          offset: 3,
          contentLength: last.length,
          chunkSha256: createHash("sha256").update(last).digest("hex"),
          body: new Blob([last]).stream(),
        })
        expect(complete).toMatchObject({
          status: "complete",
          offset: 6,
          artifact: { sha256, size: 6, expiresAt: expect.any(Number) },
        })
        if (complete.status !== "complete") throw new Error("Expected completed upload")
        expect(await Bun.file(complete.filePath).arrayBuffer()).toEqual(bytes.buffer)
        expect(CompanionTransfer.uploadStatus(upload.id, token)).toBeUndefined()
      },
    })
  })

  test("deletes a completed upload whose whole-file checksum is wrong", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const upload = await CompanionTransfer.createUpload({
          filename: "changed.bin",
          mime: "application/octet-stream",
          size: 3,
          sha256: "0".repeat(64),
          sessionID: "session_changed",
          directory: tmp.path,
          deviceName: "Android test",
        })
        const url = new URL(upload.uploadPath, "http://localhost")
        const token = url.searchParams.get("token")!
        await expect(
          CompanionTransfer.acceptUploadChunk({
            id: upload.id,
            token,
            offset: 0,
            contentLength: 3,
            body: new Blob([new Uint8Array([1, 2, 3])]).stream(),
          }),
        ).rejects.toThrow("checksum did not match")
        expect(CompanionTransfer.uploadStatus(upload.id, token)).toBeUndefined()
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
