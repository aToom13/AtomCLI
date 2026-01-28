
import { describe, expect, test } from "bun:test"
import { createRalphFlow } from "@/flow/ralph"
import { FlowRunner } from "@/flow/runner"
import { FlowContext } from "@/flow/context"
import { Instance } from "@/project/instance"
import { tmpdir } from "../../test/fixture/fixture"

describe("Agent Flow System", () => {

    test("Ralph Loop should initialize and execute tasks", async () => {
        // Use a temporary directory + Instance context to avoid polluting globals
        await using dir = await tmpdir({ git: true })

        await Instance.provide({
            directory: dir.path,
            fn: async () => {
                const instruction = "Test Project Interaction"
                const flow = createRalphFlow(instruction)
                const context = new FlowContext()

                // Ensure starting state is clean
                expect(context.getChain().steps.length).toBe(0)

                // Using a dummy session object
                const session = { id: "test-session" }

                const runner = new FlowRunner(flow, session, context)

                // Run the flow
                await runner.run()

                // Assertions
                const chain = context.getChain()

                // 1. Check if Planner added steps
                expect(chain.steps.length).toBeGreaterThan(0)
                expect(chain.steps[0].name).toBe("Initialize Project Structure")

                // 2. Check if all steps are completed
                const allComplete = chain.steps.every(s => s.status === "complete")
                expect(allComplete).toBe(true)
            }
        })
    }, 10000)
})
