import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"

export function DialogSkillList(props: {
  skills: { name: string; description: string; location?: string }[]
  onLoad: (name: string) => Promise<void> | void
}) {
  const dialog = useDialog()
  const toast = useToast()
  return (
    <DialogSelect
      title="Load skill"
      options={props.skills.map((skill) => ({
        title: skill.name,
        value: skill.name,
        description: `${skill.description}${skill.location ? ` · ${skill.location}` : ""}`,
      }))}
      emptyMessage="No installed skills"
      onSelect={async (option) => {
        try {
          await props.onLoad(option.value)
          dialog.clear()
        } catch (error) {
          toast.show({
            title: "Load skill",
            message: error instanceof Error ? error.message : String(error),
            variant: "error",
          })
        }
      }}
    />
  )
}
