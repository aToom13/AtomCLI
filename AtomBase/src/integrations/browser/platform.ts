import fs from "fs"

export type LinuxDistro = "debian" | "arch" | "fedora" | "other"

export function detectLinuxDistro(): LinuxDistro | null {
  if (process.platform !== "linux") return null
  try {
    const content = fs.readFileSync("/etc/os-release", "utf8")
    const id = content.match(/^ID=["']?([^"'\n]+)["']?$/m)?.[1] ?? ""
    const idLike = content.match(/^ID_LIKE=["']?([^"'\n]+)["']?$/m)?.[1] ?? ""
    const combined = `${id} ${idLike}`.toLowerCase()
    if (combined.includes("debian") || combined.includes("ubuntu")) return "debian"
    if (combined.includes("arch") || combined.includes("cachyos")) return "arch"
    if (combined.includes("fedora") || combined.includes("rhel") || combined.includes("centos")) return "fedora"
    return "other"
  } catch {
    return null
  }
}

export function processAncestors(): number[] {
  const result: number[] = []
  const seen = new Set<number>()
  let pid = process.pid
  while (pid > 1 && !seen.has(pid)) {
    seen.add(pid)
    result.push(pid)
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8")
      const end = stat.lastIndexOf(")")
      if (end < 0) break
      const parent = Number(stat.slice(end + 2).trim().split(/\s+/)[1])
      if (!Number.isInteger(parent) || parent <= 0) break
      pid = parent
    } catch {
      break
    }
  }
  return result
}

export async function hyprlandClients(): Promise<Array<any>> {
  if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) return []
  try {
    const clients = Bun.spawn(["hyprctl", "clients", "-j"], { stdout: "pipe", stderr: "ignore" })
    const output = await new Response(clients.stdout).text()
    if ((await clients.exited) !== 0) return []
    const parsed = JSON.parse(output)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
