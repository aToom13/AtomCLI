import { describe, test, expect } from "bun:test"
import { _parsers } from "../../src/tool/fix_it"

const {
    parseTSJSError,
    parseBunModuleError,
    parseBunCompileError,
    parsePythonError,
    parseGenericError,
    parseErrorOutput,
    detectLanguage,
} = _parsers

describe("fix_it parsers", () => {
    describe("parseTSJSError", () => {
        test("parses TypeError with stack trace", () => {
            const output = `TypeError: Cannot read properties of undefined (reading 'name')
    at processUser (/home/user/project/src/user.ts:42:15)
    at main (/home/user/project/src/index.ts:10:3)`

            const result = parseTSJSError(output)
            expect(result).not.toBeNull()
            expect(result!.errorType).toBe("TypeError")
            expect(result!.errorMessage).toBe("Cannot read properties of undefined (reading 'name')")
            expect(result!.filePath).toBe("/home/user/project/src/user.ts")
            expect(result!.line).toBe(42)
            expect(result!.column).toBe(15)
            expect(result!.stackTrace).toHaveLength(2)
            expect(result!.language).toBe("typescript")
        })

        test("parses SyntaxError", () => {
            const output = `SyntaxError: Unexpected token '}'
    at Object.compileFunction (node:vm:360:18)`

            const result = parseTSJSError(output)
            expect(result).not.toBeNull()
            expect(result!.errorType).toBe("SyntaxError")
            expect(result!.errorMessage).toBe("Unexpected token '}'")
        })

        test("returns null for non-JS errors", () => {
            const output = "some random output without error pattern"
            expect(parseTSJSError(output)).toBeNull()
        })
    })

    describe("parseBunModuleError", () => {
        test("parses 'Cannot find module'", () => {
            const output = `error: Cannot find module './missing-file' from '/home/user/project/src/index.ts'`

            const result = parseBunModuleError(output)
            expect(result).not.toBeNull()
            expect(result!.errorType).toBe("ModuleNotFoundError")
            expect(result!.errorMessage).toContain("./missing-file")
            expect(result!.filePath).toBe("/home/user/project/src/index.ts")
        })

        test("parses 'Could not resolve'", () => {
            const output = `error: Could not resolve '@tui/missing-package' from '/src/app.tsx'`

            const result = parseBunModuleError(output)
            expect(result).not.toBeNull()
            expect(result!.errorType).toBe("ModuleNotFoundError")
            expect(result!.errorMessage).toContain("@tui/missing-package")
        })

        test("returns null for non-module errors", () => {
            expect(parseBunModuleError("error: something else")).toBeNull()
        })
    })

    describe("parseBunCompileError", () => {
        test("parses Bun compile error with file:line:col", () => {
            const output = `/home/user/project/src/app.tsx:15:3: error: Unexpected token`

            const result = parseBunCompileError(output)
            expect(result).not.toBeNull()
            expect(result!.errorType).toBe("CompileError")
            expect(result!.errorMessage).toBe("Unexpected token")
            expect(result!.filePath).toBe("/home/user/project/src/app.tsx")
            expect(result!.line).toBe(15)
            expect(result!.column).toBe(3)
        })

        test("returns null for non-compile errors", () => {
            expect(parseBunCompileError("some other error")).toBeNull()
        })
    })

    describe("parsePythonError", () => {
        test("parses Python traceback", () => {
            const output = `Traceback (most recent call last):
  File "/home/user/app.py", line 25, in main
    result = process(data)
  File "/home/user/utils.py", line 10, in process
    return data["key"]
KeyError: 'key'`

            const result = parsePythonError(output)
            expect(result).not.toBeNull()
            expect(result!.errorType).toBe("KeyError")
            expect(result!.errorMessage).toBe("'key'")
            expect(result!.filePath).toBe("/home/user/app.py")
            expect(result!.line).toBe(25)
            expect(result!.stackTrace!.length).toBeGreaterThan(0)
            expect(result!.language).toBe("python")
        })

        test("returns null for non-Python output", () => {
            expect(parsePythonError("TypeError: something")).toBeNull()
        })
    })

    describe("parseGenericError", () => {
        test("extracts file:line from generic output", () => {
            const output = `Build failed\nsrc/main.ts:42 unexpected end of input`

            const result = parseGenericError(output)
            expect(result.errorType).toBe("RuntimeError")
            expect(result.filePath).toBe("src/main.ts")
            expect(result.line).toBe(42)
        })

        test("extracts error message from 'error:' pattern", () => {
            const output = `fatal: something went wrong`

            const result = parseGenericError(output)
            expect(result.errorMessage).toBe("something went wrong")
        })

        test("falls back to last line for unknown format", () => {
            const output = `line 1\nline 2\nactual error here`

            const result = parseGenericError(output)
            expect(result.errorMessage).toBe("actual error here")
        })
    })

    describe("parseErrorOutput (priority)", () => {
        test("TS/JS errors take priority", () => {
            const output = `TypeError: x is not a function
    at foo (/bar.ts:1:1)`

            const result = parseErrorOutput(output)
            expect(result.errorType).toBe("TypeError")
            expect(result.language).toBe("typescript")
        })

        test("Bun module errors override generic", () => {
            const output = `error: Cannot find module './foo' from '/bar.ts'`

            const result = parseErrorOutput(output)
            expect(result.errorType).toBe("ModuleNotFoundError")
        })

        test("Python tracebacks are detected", () => {
            const output = `Traceback (most recent call last):
  File "test.py", line 1, in <module>
ValueError: bad value`

            const result = parseErrorOutput(output)
            expect(result.errorType).toBe("ValueError")
            expect(result.language).toBe("python")
        })

        test("falls back to generic for unknown format", () => {
            const output = `something failed badly`

            const result = parseErrorOutput(output)
            expect(result.errorType).toBe("RuntimeError")
        })
    })

    describe("detectLanguage", () => {
        test("detects TypeScript", () => {
            expect(detectLanguage("foo.ts")).toBe("typescript")
            expect(detectLanguage("bar.tsx")).toBe("typescript")
        })

        test("detects JavaScript", () => {
            expect(detectLanguage("foo.js")).toBe("javascript")
            expect(detectLanguage("bar.mjs")).toBe("javascript")
        })

        test("detects Python", () => {
            expect(detectLanguage("script.py")).toBe("python")
        })

        test("returns extension for unknown", () => {
            expect(detectLanguage("file.xyz")).toBe("xyz")
        })
    })
})
