export namespace Http {
  export async function readText(response: Response, maxBytes: number) {
    const declaredSize = Number(response.headers.get("content-length") ?? 0)
    if (declaredSize > maxBytes) throw new Error(`Response exceeds the ${maxBytes} byte limit`)
    if (!response.body) return ""

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let content = ""
    let bytes = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > maxBytes) {
          await reader.cancel()
          throw new Error(`Response exceeds the ${maxBytes} byte limit`)
        }
        content += decoder.decode(value, { stream: true })
      }
      return content + decoder.decode()
    } finally {
      reader.releaseLock()
    }
  }
}
