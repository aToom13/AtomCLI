const MAX_TEXT_DATA_URL_BYTES = 1024 * 1024

export namespace DataUrl {
  export function decodeText(input: string) {
    if (!input.startsWith("data:")) throw new Error("Text attachment must use a data URL")
    const separator = input.indexOf(",")
    if (separator < 0) throw new Error("Text attachment data URL is missing its payload separator")

    const header = input.slice(5, separator)
    const segments = header.split(";")
    const mediaType = segments[0].toLowerCase()
    if (mediaType && mediaType !== "text/plain") {
      throw new Error(`Text attachment data URL declares unsupported media type: ${mediaType}`)
    }

    const base64 = segments.slice(1).some((segment) => segment.toLowerCase() === "base64")
    const payload = input.slice(separator + 1)
    let bytes: Buffer
    if (base64) {
      if (
        payload.length % 4 !== 0 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)
      ) {
        throw new Error("Text attachment contains invalid base64 data")
      }
      bytes = Buffer.from(payload, "base64")
    } else {
      let decoded: string
      try {
        decoded = decodeURIComponent(payload)
      } catch {
        throw new Error("Text attachment contains invalid percent-encoded data")
      }
      bytes = Buffer.from(decoded, "utf8")
    }

    if (bytes.byteLength > MAX_TEXT_DATA_URL_BYTES) {
      throw new Error(`Text attachment exceeds the ${MAX_TEXT_DATA_URL_BYTES} byte limit`)
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    } catch {
      throw new Error("Text attachment is not valid UTF-8")
    }
  }
}
