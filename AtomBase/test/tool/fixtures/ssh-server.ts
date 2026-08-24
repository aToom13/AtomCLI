import fs from "fs/promises"
import path from "path"
import { generateKeyPairSync } from "crypto"
import { Server, utils } from "ssh2"

const Sftp = utils.sftp

const USERNAME = "test-user"
const PASSWORD = "test-password"

type Handle =
  | { type: "file"; file: fs.FileHandle }
  | {
      type: "directory"
      entries: Array<{ filename: string; longname: string; attrs: Record<string, number> }>
      sent: boolean
    }

export async function createSshTestServer(root: string, options: { dropConnections?: number } = {}) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const hostKey = privateKey.export({ type: "pkcs1", format: "pem" })
  let connectionAttempts = 0
  const sockets = new Set<{ destroy(): void; once(event: "close", listener: () => void): void }>()
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on("authentication", (context) => {
      if (context.method === "password" && context.username === USERNAME && context.password === PASSWORD)
        context.accept()
      else context.reject()
    })
    client.on("ready", () => {
      client.on("session", (accept) => {
        const session = accept()
        session.on("exec", (accept, _reject, info) => {
          const channel = accept()
          const match = info.command.match(/^printf '([^']*)'$/)
          channel.write(match?.[1] ?? `executed: ${info.command}`)
          channel.exit(0)
          channel.end()
        })
        session.on("sftp", (accept) => attachSftp(accept(), root))
      })
    })
  })

  // Drop raw TCP connections before ssh2 starts the handshake. Doing this in
  // the SSH client callback is too late: that callback runs after key exchange.
  const tcpServer = (
    server as unknown as { _srv: { prependListener(event: string, listener: (socket: any) => void): void } }
  )._srv
  tcpServer.prependListener(
    "connection",
    (socket: { destroy(): void; once(event: "close", listener: () => void): void }) => {
      connectionAttempts++
      sockets.add(socket)
      socket.once("close", () => sockets.delete(socket))
      if (connectionAttempts <= (options.dropConnections ?? 0)) socket.destroy()
    },
  )

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("SSH test server has no TCP address")

  return {
    host: "127.0.0.1",
    port: address.port,
    username: USERNAME,
    password: PASSWORD,
    get connectionAttempts() {
      return connectionAttempts
    },
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    },
  }
}

function attachSftp(sftp: any, root: string) {
  const handles = new Map<number, Handle>()
  let nextHandle = 1

  const resolvePath = (remotePath: string) => {
    const resolved = path.resolve(root, `.${path.posix.resolve("/", remotePath)}`)
    if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error("Path escapes fixture root")
    return resolved
  }
  const handleBuffer = (id: number) => {
    const value = Buffer.alloc(4)
    value.writeUInt32BE(id)
    return value
  }
  const lookup = (value: Buffer) => (value.length === 4 ? handles.get(value.readUInt32BE(0)) : undefined)
  const attrs = (value: Awaited<ReturnType<typeof fs.lstat>>) => ({
    mode: Number(value.mode),
    uid: Number(value.uid),
    gid: Number(value.gid),
    size: Number(value.size),
    atime: Math.floor(Number(value.atimeMs) / 1000),
    mtime: Math.floor(Number(value.mtimeMs) / 1000),
  })
  const failure = (request: number, error: unknown) => {
    const code =
      (error as NodeJS.ErrnoException).code === "ENOENT" ? Sftp.STATUS_CODE.NO_SUCH_FILE : Sftp.STATUS_CODE.FAILURE
    sftp.status(request, code)
  }

  sftp.on("REALPATH", (request, remotePath) => {
    sftp.name(request, [{ filename: path.posix.resolve("/", remotePath), longname: remotePath, attrs: {} }])
  })
  for (const event of ["STAT", "LSTAT"] as const) {
    sftp.on(event, (request, remotePath) => {
      fs.lstat(resolvePath(remotePath))
        .then((value) => sftp.attrs(request, attrs(value)))
        .catch((error) => failure(request, error))
    })
  }
  sftp.on("OPEN", (request, remotePath, flags) => {
    const readable = Boolean(flags & Sftp.OPEN_MODE.READ)
    const writable = Boolean(flags & Sftp.OPEN_MODE.WRITE)
    const append = Boolean(flags & Sftp.OPEN_MODE.APPEND)
    const truncate = Boolean(flags & Sftp.OPEN_MODE.TRUNC)
    const create = Boolean(flags & Sftp.OPEN_MODE.CREAT)
    const mode = append ? "a+" : truncate || create ? (readable ? "w+" : "w") : writable ? "r+" : "r"
    fs.open(resolvePath(remotePath), mode)
      .then((file) => {
        const id = nextHandle++
        handles.set(id, { type: "file", file })
        sftp.handle(request, handleBuffer(id))
      })
      .catch((error) => failure(request, error))
  })
  sftp.on("READ", (request, rawHandle, offset, length) => {
    const handle = lookup(rawHandle)
    if (!handle || handle.type !== "file") return sftp.status(request, Sftp.STATUS_CODE.FAILURE)
    const buffer = Buffer.alloc(length)
    handle.file
      .read(buffer, 0, length, offset)
      .then(({ bytesRead }) => {
        if (bytesRead === 0) sftp.status(request, Sftp.STATUS_CODE.EOF)
        else sftp.data(request, buffer.subarray(0, bytesRead))
      })
      .catch((error) => failure(request, error))
  })
  sftp.on("WRITE", (request, rawHandle, offset, data) => {
    const handle = lookup(rawHandle)
    if (!handle || handle.type !== "file") return sftp.status(request, Sftp.STATUS_CODE.FAILURE)
    handle.file
      .write(data, 0, data.length, offset)
      .then(() => sftp.status(request, Sftp.STATUS_CODE.OK))
      .catch((error) => failure(request, error))
  })
  sftp.on("CLOSE", (request, rawHandle) => {
    const id = rawHandle.length === 4 ? rawHandle.readUInt32BE(0) : -1
    const handle = handles.get(id)
    if (!handle) return sftp.status(request, Sftp.STATUS_CODE.FAILURE)
    handles.delete(id)
    if (handle.type === "file")
      handle.file
        .close()
        .then(() => sftp.status(request, Sftp.STATUS_CODE.OK))
        .catch((error) => failure(request, error))
    else sftp.status(request, Sftp.STATUS_CODE.OK)
  })
  sftp.on("OPENDIR", (request, remotePath) => {
    fs.readdir(resolvePath(remotePath), { withFileTypes: true })
      .then(async (values) => {
        const entries = await Promise.all(
          values.map(async (value) => {
            const stat = await fs.lstat(path.join(resolvePath(remotePath), value.name))
            return { filename: value.name, longname: value.name, attrs: attrs(stat) }
          }),
        )
        const id = nextHandle++
        handles.set(id, { type: "directory", entries, sent: false })
        sftp.handle(request, handleBuffer(id))
      })
      .catch((error) => failure(request, error))
  })
  sftp.on("READDIR", (request, rawHandle) => {
    const handle = lookup(rawHandle)
    if (!handle || handle.type !== "directory") return sftp.status(request, Sftp.STATUS_CODE.FAILURE)
    if (handle.sent) return sftp.status(request, Sftp.STATUS_CODE.EOF)
    handle.sent = true
    sftp.name(request, handle.entries)
  })
  sftp.on("MKDIR", (request, remotePath) => {
    fs.mkdir(resolvePath(remotePath))
      .then(() => sftp.status(request, Sftp.STATUS_CODE.OK))
      .catch((error) => failure(request, error))
  })
  sftp.on("REMOVE", (request, remotePath) => {
    fs.unlink(resolvePath(remotePath))
      .then(() => sftp.status(request, Sftp.STATUS_CODE.OK))
      .catch((error) => failure(request, error))
  })
  sftp.on("RMDIR", (request, remotePath) => {
    fs.rmdir(resolvePath(remotePath))
      .then(() => sftp.status(request, Sftp.STATUS_CODE.OK))
      .catch((error) => failure(request, error))
  })
}
