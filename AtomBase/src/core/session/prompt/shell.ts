const DEFAULT_OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024
export const OUTPUT_UPDATE_INTERVAL_MS = 50
const TRUNCATION_MARKER = "[earlier shell output truncated]\n"

export function appendOutput(current: string, chunk: string, limitBytes = DEFAULT_OUTPUT_LIMIT_BYTES) {
  const alreadyTruncated = current.startsWith(TRUNCATION_MARKER)
  const previous = alreadyTruncated ? current.slice(TRUNCATION_MARKER.length) : current
  const combined = previous + chunk
  if (!alreadyTruncated && new TextEncoder().encode(combined).byteLength <= limitBytes) return combined
  const markerBytes = new TextEncoder().encode(TRUNCATION_MARKER).byteLength
  const tailBudget = Math.max(0, limitBytes - markerBytes)
  let low = 0
  let high = combined.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (new TextEncoder().encode(combined.slice(middle)).byteLength <= tailBudget) high = middle
    else low = middle + 1
  }
  return TRUNCATION_MARKER + combined.slice(low)
}
