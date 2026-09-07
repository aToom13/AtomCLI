import { Storage } from "../../src/core/storage/storage"

const [, , operation, encodedKey, value = "0", startAt = "0"] = process.argv
const key = JSON.parse(encodedKey) as string[]

while (Date.now() < Number(startAt)) await Bun.sleep(1)

if (operation === "write") {
  await Storage.write(key, { value: Number(value) })
} else if (operation === "increment") {
  for (let index = 0; index < Number(value); index++) {
    await Storage.update<{ value: number }>(key, (draft) => {
      draft.value++
    })
  }
} else if (operation === "remove") {
  await Storage.remove(key)
} else if (operation === "read") {
  process.stdout.write(JSON.stringify(await Storage.read(key)))
} else {
  throw new Error(`Unknown storage worker operation: ${operation}`)
}
