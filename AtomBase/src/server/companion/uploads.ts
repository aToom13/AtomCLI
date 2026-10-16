import { Hono } from "hono"
import { Instance } from "@/services/project/instance"
import { CompanionTransfer } from "@/services/companion/transfer"
import { inDirectory, resolveCompanionDirectory } from "./directory"
import { diagnosticError, log } from "./helpers"

export const CompanionUploadRoutes = new Hono()
  .get("/companion/upload/:id", async (c) => {
    const directory = c.req.query("directory")
    const token = c.req.query("token") ?? ""
    const selected = await resolveCompanionDirectory(directory, Instance.directory)
    const status = await inDirectory(selected, Instance.directory, () =>
      CompanionTransfer.uploadStatus(c.req.param("id"), token),
    )
    if (!status) return c.json({ error: "upload_not_found" }, 404)
    return c.json(
      {
        offset: status.offset,
        size: status.size,
        expires_at: status.expiresAt,
        chunk_size: status.chunkSize,
      },
      200,
      { "cache-control": "no-store" },
    )
  })
  .patch("/companion/upload/:id", async (c) => {
    try {
      const directory = c.req.query("directory")
      const token = c.req.query("token") ?? ""
      const selected = await resolveCompanionDirectory(directory, Instance.directory)
      const offset = Number(c.req.header("upload-offset"))
      const contentLength = Number(c.req.header("content-length"))
      const result = await inDirectory(selected, Instance.directory, () =>
        CompanionTransfer.acceptUploadChunk({
          id: c.req.param("id"),
          token,
          offset,
          contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
          chunkSha256: c.req.header("x-chunk-sha256"),
          body: c.req.raw.body,
        }),
      )
      return c.json({
        status: result.status,
        offset: result.offset,
        size: result.size,
        ...(result.status === "complete" ? { artifact: result.artifact } : {}),
      })
    } catch (err) {
      log.error("mobile upload chunk failed", { error: diagnosticError(err) })
      return c.json({ error: err instanceof Error ? err.message : "upload_chunk_failed" }, 400)
    }
  })
  .put("/companion/upload/:id", async (c) => {
    try {
      const directory = c.req.query("directory")
      const token = c.req.query("token") ?? ""
      const selected = await resolveCompanionDirectory(directory, Instance.directory)
      const contentLengthHeader = c.req.header("content-length")
      const contentLength = contentLengthHeader ? Number(contentLengthHeader) : undefined
      const result = await inDirectory(selected, Instance.directory, () =>
        CompanionTransfer.acceptUpload({
          id: c.req.param("id"),
          token,
          contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
          body: c.req.raw.body,
        }),
      )
      return c.json({ status: "ok", artifact: result.artifact })
    } catch (err) {
      log.error("mobile upload failed", { error: diagnosticError(err) })
      return c.json({ error: err instanceof Error ? err.message : "upload_failed" }, 400)
    }
  })
