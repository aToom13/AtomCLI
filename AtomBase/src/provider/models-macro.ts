export async function data() {
  const path = Bun.env.MODELS_DEV_API_JSON
  if (path) {
    const file = Bun.file(path)
    if (await file.exists()) {
      return await file.text()
    }
  }
  // try {
  //   const json = await fetch("https://models.dev/api.json").then((x) => x.text())
  //   return json
  // } catch (error) {
  //   console.error("Failed to fetch models: ", error)
  //   return "{}"
  // }
  return "{}"
}
