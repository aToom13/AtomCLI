const HASH_PREFIX = "sha256:"
const LINE_ANCHOR_PATTERN = /^L([1-9]\d*):sha256:([a-f0-9]{64})$/
const MAX_ANCHORED_LINE_LENGTH = 2000

function digest(value: string | Uint8Array) {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex")
}

function visibleLine(value: string) {
  const normalized = value.endsWith("\r") ? value.slice(0, -1) : value
  return normalized.length > MAX_ANCHORED_LINE_LENGTH
    ? `${normalized.slice(0, MAX_ANCHORED_LINE_LENGTH)}...`
    : normalized
}

export namespace EditAnchor {
  export type Range = {
    start: number
    end: number
    startLine: number
    endLine: number
  }

  export function contentHash(content: string | Uint8Array) {
    return `${HASH_PREFIX}${digest(content)}`
  }

  export function range(startLine: number, content: string[]) {
    const lines = content.length > 0 ? content.map(visibleLine) : [""]
    const endLine = startLine + lines.length - 1
    return {
      startAnchor: `L${startLine}:${HASH_PREFIX}${digest(lines[0])}`,
      endAnchor: `L${endLine}:${HASH_PREFIX}${digest(lines.join("\n"))}`,
    }
  }

  export function resolveRange(content: string, startAnchor: string, endAnchor: string): Range {
    const start = parse(startAnchor)
    const end = parse(endAnchor)
    if (!start || !end) {
      throw new Error(
        "Invalid edit anchor format. Read the file again and use the returned startAnchor/endAnchor values",
      )
    }
    if (start.line > end.line) {
      throw new Error("Invalid edit anchor range: startAnchor must not follow endAnchor")
    }

    const lines = content.split("\n")
    const startValue = lines[start.line - 1]
    const endValue = lines[end.line - 1]
    if (
      startValue === undefined ||
      endValue === undefined ||
      digest(visibleLine(startValue)) !== start.hash ||
      digest(
        lines
          .slice(start.line - 1, end.line)
          .map(visibleLine)
          .join("\n"),
      ) !== end.hash
    ) {
      throw new Error("Stale edit: anchored content changed. Read the file again before editing")
    }

    let startOffset = 0
    for (let index = 0; index < start.line - 1; index++) startOffset += lines[index].length + 1
    let endOffset = startOffset
    for (let index = start.line - 1; index < end.line; index++) {
      endOffset += lines[index].length
      if (index < end.line - 1) endOffset++
    }
    return { start: startOffset, end: endOffset, startLine: start.line, endLine: end.line }
  }

  function parse(value: string) {
    const match = LINE_ANCHOR_PATTERN.exec(value)
    if (!match) return
    return { line: Number(match[1]), hash: match[2] }
  }
}
