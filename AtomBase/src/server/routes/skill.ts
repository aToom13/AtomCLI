import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { Skill } from "@/integrations/skill"
import { errors } from "../error"

export const SkillRoute = new Hono().get(
  "/",
  describeRoute({
    summary: "List installed skills",
    description: "Get a list of all installed skills with their names and descriptions.",
    operationId: "skill.list",
    responses: {
      200: {
        description: "List of skills",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                skills: z.array(
                  z.object({
                    name: z.string(),
                    description: z.string(),
                    location: z.string(),
                  }),
                ),
              }),
            ),
          },
        },
      },
      ...errors(400),
    },
  }),
  async (c) => {
    const skills = await Skill.all()
    return c.json({
      skills: skills.map((s) => ({
        name: s.name,
        description: s.description,
        location: s.location,
      })),
    })
  },
)
