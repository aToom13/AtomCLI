import type { Config } from "@/core/config/config"

export namespace AdaptivePolicy {
  export const Defaults = {
    mode: "ask" as const,
    thinking: { mode: "ask" as const },
    base_models: [] as string[],
    expert_models: [] as string[],
    max_expert_episodes: 2,
    max_expert_calls: 3,
    max_expert_steps: 3,
    cooldown_steps: 3,
    proposal_ttl_ms: 120_000,
    return_to_base: true,
  }

  type Settings = NonNullable<Config.Info["adaptive_routing"]>
  export function withDefaults(
    input?: Partial<Omit<Settings, "thinking">> & { thinking?: Partial<Settings["thinking"]> },
  ) {
    return { ...Defaults, ...input, thinking: { ...Defaults.thinking, ...input?.thinking } }
  }
}
