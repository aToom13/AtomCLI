import { Instance } from "@/services/project/instance"

export namespace SessionExecutionProfile {
  export type Name = "standard" | "companion-fast"

  const profiles = Instance.state(() => new Map<string, Name>())

  export function get(sessionID: string): Name {
    return profiles().get(sessionID) ?? "standard"
  }

  export function set(sessionID: string, profile: Name): void {
    profiles().set(sessionID, profile)
  }

  export function inherit(parentSessionID: string, childSessionID: string): void {
    set(childSessionID, get(parentSessionID))
  }
}
