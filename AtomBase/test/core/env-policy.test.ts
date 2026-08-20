import { describe, expect, test } from "bun:test"
import { EnvPolicy } from "@/core/env/policy"

const source = {
  PATH: "/usr/bin",
  HOME: "/tmp/home",
  USER: "tester",
  SHELL: "/bin/sh",
  LANG: "C.UTF-8",
  OPENAI_API_KEY: "openai-secret",
  ANTHROPIC_API_KEY: "anthropic-secret",
  AWS_SECRET_ACCESS_KEY: "aws-secret",
  GITHUB_TOKEN: "github-secret",
  SAFE_EXTRA: "allowed",
}

describe("EnvPolicy", () => {
  test("minimal mode keeps process essentials and removes ambient credentials", () => {
    const env = EnvPolicy.build({ source, cwd: "/workspace" })
    expect(env.PATH).toBe("/usr/bin")
    expect(env.HOME).toBe("/tmp/home")
    expect(env.PWD).toBe("/workspace")
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(env.GITHUB_TOKEN).toBeUndefined()
  })

  test("filtered mode only adds allowlisted values", () => {
    const env = EnvPolicy.build({ mode: "filtered", allow: ["SAFE_EXTRA"], source })
    expect(env.SAFE_EXTRA).toBe("allowed")
    expect(env.OPENAI_API_KEY).toBeUndefined()
  })

  test("a scoped, unexpired grant exposes only its named value", () => {
    const env = EnvPolicy.build({
      source,
      scope: "tool:bash",
      now: 100,
      grants: [
        { name: "OPENAI_API_KEY", scope: "tool:bash", expiresAt: 101 },
        { name: "ANTHROPIC_API_KEY", scope: "pty", expiresAt: 101 },
        { name: "GITHUB_TOKEN", scope: "tool:bash", expiresAt: 99 },
      ],
    })
    expect(env.OPENAI_API_KEY).toBe("openai-secret")
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.GITHUB_TOKEN).toBeUndefined()
  })

  test("inherit mode fails closed without explicit approval", () => {
    expect(() => EnvPolicy.build({ mode: "inherit", source })).toThrow("requires explicit approval")
  })
})
