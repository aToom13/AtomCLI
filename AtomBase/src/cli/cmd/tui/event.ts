import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"

export const TuiEvent = {
  PromptAppend: BusEvent.define("tui.prompt.append", z.object({ text: z.string() })),
  CommandExecute: BusEvent.define(
    "tui.command.execute",
    z.object({
      command: z.union([
        z.enum([
          "session.list",
          "session.new",
          "session.share",
          "session.interrupt",
          "session.compact",
          "session.page.up",
          "session.page.down",
          "session.half.page.up",
          "session.half.page.down",
          "session.first",
          "session.last",
          "prompt.clear",
          "prompt.submit",
          "agent.cycle",
        ]),
        z.string(),
      ]),
    }),
  ),
  ToastShow: BusEvent.define(
    "tui.toast.show",
    z.object({
      title: z.string().optional(),
      message: z.string(),
      variant: z.enum(["info", "success", "warning", "error"]),
      duration: z.number().default(5000).optional().describe("Duration in milliseconds"),
    }),
  ),
  SessionSelect: BusEvent.define(
    "tui.session.select",
    z.object({
      sessionID: z.string().regex(/^ses/).describe("Session ID to navigate to"),
    }),
  ),
  // Chain events for agent task chain UI
  ChainStart: BusEvent.define(
    "tui.chain.start",
    z.object({
      mode: z.enum(["safe", "autonomous"]).default("safe"),
    }),
  ),
  ChainAddStep: BusEvent.define(
    "tui.chain.add_step",
    z.object({
      name: z.string(),
      description: z.string(),
      todos: z.array(z.object({
        id: z.string(),
        content: z.string(),
        status: z.enum(["pending", "in_progress", "complete", "failed"]),
      })).optional(),
    }),
  ),
  ChainUpdateStep: BusEvent.define(
    "tui.chain.update_step",
    z.object({
      status: z.enum([
        "pending", "running", "coding", "searching_web", "searching_code",
        "reading_file", "writing_file", "running_command", "analyzing",
        "thinking", "complete", "failed", "retrying"
      ]),
      tool: z.string().optional(),
    }),
  ),
  ChainCompleteStep: BusEvent.define(
    "tui.chain.complete_step",
    z.object({
      output: z.string().optional(),
    }),
  ),
  ChainFailStep: BusEvent.define(
    "tui.chain.fail_step",
    z.object({
      error: z.string(),
    }),
  ),
  ChainSetTodos: BusEvent.define(
    "tui.chain.set_todos",
    z.object({
      todos: z.array(z.object({
        id: z.string(),
        content: z.string(),
        status: z.enum(["pending", "in_progress", "complete", "failed"]),
      })),
    }),
  ),
  ChainTodoDone: BusEvent.define(
    "tui.chain.todo_done",
    z.object({
      todoIndex: z.number(),
    }),
  ),
  ChainClear: BusEvent.define("tui.chain.clear", z.object({})),

  // File Tree events for file browser and code panel
  FileTreeToggle: BusEvent.define("tui.filetree.toggle", z.object({})),
  FileTreeOpen: BusEvent.define(
    "tui.filetree.open",
    z.object({
      path: z.string(),
      content: z.string().optional(),
      language: z.string().optional(),
      highlight: z.object({
        startLine: z.number(),
        endLine: z.number(),
      }).optional(),
    }),
  ),
  FileTreeClose: BusEvent.define(
    "tui.filetree.close",
    z.object({
      path: z.string(),
    }),
  ),
  FileTreeDirToggle: BusEvent.define(
    "tui.filetree.dir_toggle",
    z.object({
      path: z.string(),
    }),
  ),
  CodePanelToggle: BusEvent.define("tui.codepanel.toggle", z.object({})),
  CodePanelSave: BusEvent.define(
    "tui.codepanel.save",
    z.object({
      path: z.string(),
      content: z.string(),
    }),
  ),
}


