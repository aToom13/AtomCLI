import z from "zod"
import { Tool } from "./tool"
import { Question } from "@/interfaces/question"
import DESCRIPTION from "./question.txt"
import { parseJsonIfString } from "@/util/util/zod"

export const QuestionTool = Tool.define("question", {
  description: DESCRIPTION,
  parameters: z.object({
    questions: parseJsonIfString(z.array(Question.Info).min(1).max(10)).describe(
      "Questions to ask (support text, password, and select types)",
    ),
  }),
  async execute(params, ctx) {
    for (const question of params.questions) {
      if ((question.type ?? "select") === "select" && !question.options?.length) {
        throw new Error("Select questions require at least one option")
      }
      if (question.question.length > 2_000 || (question.placeholder?.length ?? 0) > 2_000) {
        throw new Error("Question and placeholder text must be at most 2000 characters")
      }
      if ((question.options?.length ?? 0) > 20) throw new Error("A question can have at most 20 options")
      if (question.options?.some((option) => option.label.length > 200 || option.description.length > 2_000)) {
        throw new Error("Question option labels must be at most 200 characters and descriptions at most 2000")
      }
    }
    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: params.questions,
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    function format(answer: Question.Answer | undefined) {
      if (!answer?.length) return "Unanswered"
      return answer.join(", ").slice(0, 20_000)
    }

    const formatted = params.questions.map((q, i) => `"${q.question}"="${format(answers[i])}"`).join(", ")

    return {
      title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
      output: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
      metadata: {
        answers: answers.map((answer) => answer.map((value) => value.slice(0, 20_000))),
      },
    }
  },
})
