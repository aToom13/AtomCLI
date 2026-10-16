import { BusEvent } from "@/core/bus/bus-event"
import z from "zod"
import { Config } from "@/core/config/config"
import { Instance } from "@/services/project/instance"
import { Identifier } from "@/core/id/id"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"
import { MCP } from "@/integrations/mcp"
import { Skill } from "@/integrations/skill"

export namespace Command {
  export const Event = {
    Executed: BusEvent.define(
      "command.executed",
      z.object({
        name: z.string(),
        sessionID: Identifier.schema("session"),
        arguments: z.string(),
        messageID: Identifier.schema("message"),
      }),
    ),
  }

  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      agent: z.string().optional(),
      model: z.string().optional(),
      mcp: z.boolean().optional(),
      // workaround for zod not supporting async functions natively so we use getters
      // https://zod.dev/v4/changelog?id=zfunction
      template: z.promise(z.string()).or(z.string()),
      subtask: z.boolean().optional(),
      hints: z.array(z.string()),
    })
    .meta({
      ref: "Command",
    })

  // for some reason zod is inferring `string` for z.promise(z.string()).or(z.string()) so we have to manually override it
  export type Info = Omit<z.infer<typeof Info>, "template"> & { template: Promise<string> | string }

  export function hints(template: string): string[] {
    const result: string[] = []
    const numbered = template.match(/\$\d+/g)
    if (numbered) {
      for (const match of [...new Set(numbered)].sort()) result.push(match)
    }
    if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
    return result
  }

  export const Default = {
    INIT: "init",
    REVIEW: "review",
    SKILL: "skill",
    BRAINSTORM: "brainstorm",
    WRITE_PLAN: "write-plan",
    EXECUTE_PLAN: "execute-plan",
    ATOMIC_WORK: "atomic-work",
  } as const

  const state = Instance.state(async () => {
    const cfg = await Config.get()

    const result: Record<string, Info> = {
      [Default.ATOMIC_WORK]: {
        name: Default.ATOMIC_WORK,
        description: "decompose, execute, and verify a durable Atomic Work goal",
        subtask: false,
        template:
          "Atomic Work goal: $ARGUMENTS\nInspect this workspace first. Use task(action='plan', tasks=[...], acceptance=[...]); do not send revision fields or placeholders. Decompose by bounded deliverables or distinct expertise, not one giant features task or micro-tasks. Put shared foundations before consumers. Declare dependencies, owns paths, real agent/skill names, and nonempty acceptance. Sequential tasks may own the same file. Use isolation='auto' in non-git workspaces; omit model unless choosing a real provider/model. Automatic commands verify structure; interactive behavior requires reviewer/parent runtime evidence. Reviewer/parent criteria have no command. Supply global acceptance; the harness adds independent verification of this original goal. Then task(action='execute'). Child output is submitted until criteria pass. Use task(action='status') for ledger IDs, versions, blockers and pending messages. Classify pending messages with task(action='revise', amendment={messageID, classification, evidence}, expectedVersion=...); amendments require changed definitions. Preserve independent accepted work. Continue until integration root and every task are accepted. Generic taskflow and task(action='run') are unavailable during Atomic Work.",
        hints: ["$ARGUMENTS"],
      },
      [Default.INIT]: {
        name: Default.INIT,
        description: "create/update AGENTS.md",
        get template() {
          return PROMPT_INITIALIZE.replace("${path}", Instance.worktree)
        },
        hints: hints(PROMPT_INITIALIZE),
      },
      [Default.REVIEW]: {
        name: Default.REVIEW,
        description: "review changes [commit|branch|pr], defaults to uncommitted",
        get template() {
          return PROMPT_REVIEW.replace("${path}", Instance.worktree)
        },
        subtask: true,
        hints: hints(PROMPT_REVIEW),
      },
      [Default.SKILL]: {
        name: Default.SKILL,
        description: "list installed skills",
        get template() {
          return Skill.all().then((skills) => {
            const lines = skills.map((s) => `- ${s.name}: ${s.description}`)
            return lines.length === 0 ? "No skills found." : lines.join("\n")
          })
        },
        hints: [],
      },
      [Default.BRAINSTORM]: {
        name: Default.BRAINSTORM,
        description: "generate and refine ideas for a topic",
        template:
          "Brainstorm this topic: $ARGUMENTS\nIf no topic was provided, ask for one. Otherwise, list at least 10 ideas, group them by theme, then choose the 3 most promising based on feasibility and impact. Do not start implementation unless requested.",
        hints: ["$ARGUMENTS"],
      },
      [Default.WRITE_PLAN]: {
        name: Default.WRITE_PLAN,
        description: "write a step-by-step plan for a goal",
        template:
          "Write a plan for this goal: $ARGUMENTS\nIf no goal was provided, ask for one. Otherwise, define success, list phases and concrete tasks, and identify dependencies and blockers. Keep the plan proportional to the goal.",
        hints: ["$ARGUMENTS"],
      },
      [Default.EXECUTE_PLAN]: {
        name: Default.EXECUTE_PLAN,
        description: "execute an authorized plan and verify each phase",
        template:
          "Execute this plan or goal: $ARGUMENTS\nIf no plan or goal was provided, ask for it. Otherwise, inspect current state, do the next authorized task, verify its result, and continue through the plan. Report completed work and remaining blockers. Ask before irreversible external actions requiring approval.",
        hints: ["$ARGUMENTS"],
      },
    }

    for (const [name, command] of Object.entries(cfg.command ?? {})) {
      if (name === Default.ATOMIC_WORK) continue
      result[name] = {
        name,
        agent: command.agent,
        model: command.model,
        description: command.description,
        get template() {
          return command.template
        },
        subtask: command.subtask,
        hints: hints(command.template),
      }
    }
    for (const [name, prompt] of Object.entries(await MCP.prompts())) {
      if (name === Default.ATOMIC_WORK) continue
      result[name] = {
        name,
        mcp: true,
        description: prompt.description,
        get template() {
          // since a getter can't be async we need to manually return a promise here
          return new Promise<string>(async (resolve, reject) => {
            const template = await MCP.getPrompt(
              prompt.client,
              prompt.name,
              prompt.arguments
                ? // substitute each argument with $1, $2, etc.
                  Object.fromEntries(prompt.arguments?.map((argument, i) => [argument.name, `$${i + 1}`]))
                : {},
            ).catch(reject)
            resolve(
              template?.messages
                .map((message) => (message.content.type === "text" ? message.content.text : ""))
                .join("\n") || "",
            )
          })
        },
        hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
      }
    }

    return result
  })

  export async function get(name: string) {
    return state().then((x) => x[name])
  }

  export async function list() {
    return state().then((x) => Object.values(x))
  }
}
