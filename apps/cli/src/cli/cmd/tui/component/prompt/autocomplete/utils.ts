export function removeLineRange(input: string) {
    const hashIndex = input.lastIndexOf("#")
    return hashIndex !== -1 ? input.substring(0, hashIndex) : input
}

export function extractLineRange(input: string) {
    const hashIndex = input.lastIndexOf("#")
    if (hashIndex === -1) {
        return { baseQuery: input }
    }

    const baseName = input.substring(0, hashIndex)
    const linePart = input.substring(hashIndex + 1)
    const lineMatch = linePart.match(/^(\d+)(?:-(\d*))?$/)

    if (!lineMatch) {
        return { baseQuery: baseName }
    }

    const startLine = Number(lineMatch[1])
    const endLine = lineMatch[2] && startLine < Number(lineMatch[2]) ? Number(lineMatch[2]) : undefined

    return {
        lineRange: {
            baseName,
            startLine,
            endLine,
        },
        baseQuery: baseName,
    }
}
