import { AgentEval } from "@/core/eval/harness"
import { Session } from "../index"
import { MessageV2 } from "../message-v2"
import { SessionSummary } from "../summary"

export async function ensureTitle(input: { session: Session.Info; history: MessageV2.WithParts[] }) {
  if (!AgentEval.executionPolicy(input.session.id).allowAuxiliarySummaries) return
  if (input.session.parentID) return
  if (!Session.isDefaultTitle(input.session.title)) return
  const firstRealUserIdx = input.history.findIndex(
    (m) => m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic),
  )
  if (firstRealUserIdx === -1) return
  const isFirst =
    input.history.filter((m) => m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic))
      .length === 1
  if (!isFirst) return
  const firstRealUser = input.history[firstRealUserIdx]
  const subtaskParts = firstRealUser.parts.filter((p) => p.type === "subtask") as MessageV2.SubtaskPart[]
  const hasOnlySubtaskParts = subtaskParts.length > 0 && firstRealUser.parts.every((p) => p.type === "subtask")
  const text = hasOnlySubtaskParts
    ? subtaskParts.map((part) => part.prompt).join(" ")
    : firstRealUser.parts
        .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.synthetic)
        .map((part) => part.text)
        .join(" ")
  const title = SessionSummary.localTitle(text)
  if (!title) return
  return Session.update(input.session.id, (draft) => {
    draft.title = title
  })
}
