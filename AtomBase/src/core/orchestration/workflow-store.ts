import { Storage } from "@/core/storage/storage"

export namespace WorkflowStore {
  export async function save<T extends { id: string }>(workflow: T) {
    await Storage.write(["workflow", workflow.id], structuredClone(workflow))
  }

  export async function load<T>(workflowID: string): Promise<T | undefined> {
    return Storage.read<T>(["workflow", workflowID]).catch((error) => {
      if (error instanceof Storage.NotFoundError) return undefined
      throw error
    })
  }

  export async function remove(workflowID: string) {
    try {
      await Storage.remove(["workflow", workflowID])
    } catch (error) {
      if (error instanceof Storage.NotFoundError) return
      throw error
    }
  }
}
