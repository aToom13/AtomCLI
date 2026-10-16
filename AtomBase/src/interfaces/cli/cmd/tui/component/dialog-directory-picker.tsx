import path from "path"
import os from "os"
import { createSignal, createMemo } from "solid-js"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { directoryEntries } from "./directory-picker"

export function DialogDirectoryPicker(props: {
  initial?: string
  onSelect: (directory: string) => Promise<void> | void
}) {
  const dialog = useDialog()
  const [current, setCurrent] = createSignal(props.initial || os.homedir())
  const options = createMemo(() => [
    ...directoryEntries(current()).map((directory) => ({
      title: directory === path.dirname(current()) ? "📁 .." : `📁 ${path.basename(directory)}`,
      value: directory,
      description: "Enter directory",
    })),
    { title: "✓ OK — use current directory", value: "__ok__", description: current() },
    { title: "✕ Cancel", value: "__cancel__", description: "Leave unchanged" },
  ])
  return (
    <DialogSelect
      title={`Choose working directory · ${current()}`}
      options={options()}
      onSelect={async (option) => {
        if (option.value === "__cancel__") {
          dialog.clear()
          return
        }
        if (option.value === "__ok__") {
          await props.onSelect(current())
          dialog.clear()
          return
        }
        setCurrent(option.value)
      }}
    />
  )
}
