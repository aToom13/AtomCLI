// IMPORTANT: preload before any src/ import (xdg-basedir reads env at import time).
import "../preload"

import { describe, expect, test } from "bun:test"
import { StaticGate } from "@/core/verification/static-gate"

function codesFor(source: string) {
  return StaticGate.analyze(source).diagnostics.map((d) => d.code)
}

describe("StaticGate — deterministic scope/symbol gate", () => {
  test("syntax-valid code with an undefined identifier fails the gate", () => {
    // `node --check` accepts this; the gate must reject it.
    const source = [
      "const render = (value) => value",
      "function boot() {",
      "  const ready = true",
      "  if (ready) render(undefinedThing)",
      "}",
      "boot()",
    ].join("\n")
    const result = StaticGate.analyze(source)
    expect(result.ok).toBe(false)
    expect(result.diagnostics.map((d) => d.symbol)).toEqual(["undefinedThing"])
    expect(result.diagnostics[0].code).toBe("no-undef")
  })

  test("Bun import.meta and dynamic imports are expressions, not import declarations", () => {
    const source = [
      'import {readFileSync} from "node:fs"',
      "export function load(dir=import.meta.dir) { return readFileSync(dir) }",
      'const moduleName = "node:fs"',
      "const loaded = import(moduleName)",
      "if (import.meta.main) console.log(loaded)",
    ].join("\n")
    expect(StaticGate.analyze(source).diagnostics.map((diagnostic) => diagnostic.code)).toEqual([])
  })

  test("dynamic import arguments still report undefined identifiers", () => {
    const result = StaticGate.analyze("const loaded = import(missingModule)")
    expect(result.diagnostics.map((diagnostic) => diagnostic.symbol)).toEqual(["missingModule"])
  })

  test("redeclaring an actual import binding fails the gate", () => {
    const source = 'import {readFileSync} from "node:fs"\nconst readFileSync = 1'
    expect(codesFor(source)).toContain("no-redeclare")
  })

  test("redeclaring a block-scoped binding fails the gate", () => {
    const source = ["const CONTROLS = [1]", "const CONTROLS = [2]", "console.log(CONTROLS)"].join("\n")
    const result = StaticGate.analyze(source)
    expect(result.ok).toBe(false)
    expect(codesFor(source)).toContain("no-redeclare")
  })

  test("a redeclaration nested in a different block is allowed", () => {
    const source = [
      "function a() { let value = 1; return value }",
      "function b() { let value = 2; return value }",
      "a(); b();",
    ].join("\n")
    expect(StaticGate.analyze(source).ok).toBe(true)
  })

  test("fixing both defects lets the gate pass", () => {
    const broken = ["const A = 1", "const A = 2", "console.log(A, missing)"].join("\n")
    expect(StaticGate.analyze(broken).ok).toBe(false)
    const fixed = ["const A = 1", "const B = 2", "console.log(A, B)"].join("\n")
    const result = StaticGate.analyze(fixed)
    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
  })

  test("regression: the shipped Browser OS literal `undef` is caught", () => {
    // Verbatim from the audited session (03b-apps.js:119 / neon-os.html:1506).
    const source = [
      "const WM = { close() {} }",
      "function closer() {}",
      "const body = document.body",
      "const app = {",
      "  exit() { WM.close(body.closest('.win').dataset ? undef : closer()); },",
      "}",
      "app.exit()",
    ].join("\n")
    const result = StaticGate.analyze(source)
    const symbols = result.diagnostics.map((d) => d.symbol)
    expect(symbols).toContain("undef")
    expect(result.diagnostics.find((d) => d.symbol === "undef")?.line).toBe(5)
  })

  test("ternary middles are references, not object keys", () => {
    const source = ["const out = flag ? middleValue : other", "console.log(out)"].join("\n")
    const symbols = StaticGate.analyze(source).diagnostics.map((d) => d.symbol)
    expect(symbols).toContain("flag")
    expect(symbols).toContain("middleValue")
    expect(symbols).toContain("other")
  })

  test("object keys, method names, and member access are not references", () => {
    const source = [
      "const shorthand = 1",
      "const computed = 'key'",
      "const api = {",
      "  plain: shorthand,",
      "  method() { return this.plain },",
      "  async load() { return this.plain },",
      "  *gen() { yield 1 },",
      "  [computed]: 2,",
      "}",
      "console.log(api.method(), window.location.href)",
    ].join("\n")
    expect(StaticGate.analyze(source).ok).toBe(true)
  })

  test("params, destructuring, hoisted functions and typeof guards are not undefined", () => {
    const source = [
      "function run({ mode }, list = []) {",
      "  return list.map((item) => helper(item, mode))",
      "}",
      "function helper(x, mode) { return x + mode }",
      "if (typeof optionalGlobal !== 'undefined') optionalGlobal.use()",
      "run({ mode: 1 })",
    ].join("\n")
    expect(StaticGate.analyze(source).ok).toBe(true)
  })

  test("two for-loops reusing the same loop variable do not conflict", () => {
    const source = [
      "let total = 0",
      "for (let i = 0; i < 3; i++) total += i",
      "for (let i = 0; i < 3; i++) total += i",
      "console.log(total)",
    ].join("\n")
    expect(StaticGate.analyze(source).ok).toBe(true)
  })

  test("extracts and checks inline HTML scripts, skipping external and JSON scripts", () => {
    const html = [
      "<html><body>",
      '<script src="./vendor.js"></script>',
      '<script type="application/ld+json">{"x":1}</script>',
      "<script>function go(){ return phantom() } go()</script>",
      "</body></html>",
    ].join("\n")
    const result = StaticGate.checkFile("app.html", html)
    expect(result.ok).toBe(false)
    expect(result.diagnostics.map((d) => d.symbol)).toEqual(["phantom"])
  })

  test("HTML diagnostics point to the original file across inline script boundaries", () => {
    const prefix = [
      "<style>body { color: red }</style>",
      '<script type="application/json">{}</script>',
      '<script src="vendor.js"></script>',
    ].join("\r\n")
    for (const body of ["phantom()", "const value = ;"]) {
      const html = `${prefix}\r\n<script>const ready = true</script>\r\n<h1>App</h1><script>${body}</script>`
      const diagnostic = StaticGate.checkFile("app.html", html).diagnostics[0]
      const token = body.includes("phantom") ? "phantom" : ";"
      const offset = html.lastIndexOf(token)
      const before = html.slice(0, offset)
      expect(diagnostic.line).toBe(before.split("\n").length)
      expect(diagnostic.column).toBe(offset - before.lastIndexOf("\n"))
    }
    const html = `${prefix}\n<script>\nphantom()\n</script>`
    expect(StaticGate.checkFile("app.html", html).diagnostics[0].line).toBe(5)
    expect(StaticGate.extractInlineScripts("<script>const first = 1</script><script>first++</script>")).toBe(
      "const first = 1\n;\nfirst++",
    )
  })

  test("unsupported file types are skipped, not failed", () => {
    const result = StaticGate.checkFile("data.json", "{ not javascript }")
    expect(result.analyzable).toBe(false)
    expect(result.ok).toBe(true)
  })

  test("native syntax validation rejects malformed JavaScript", () => {
    expect(StaticGate.checkFile("broken.js", "const value = ;").diagnostics[0]?.code).toBe("syntax")
  })

  test("reports the compiler's constant-assignment reason and position", () => {
    const result = StaticGate.checkFile("collision.js", "const hitB = false\nhitB = true")
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0].message).toMatch(/"hitB".*constant/)
    expect(result.diagnostics[0].line).toBe(2)
    expect(result.diagnostics[0].column).toBe(1)
    expect(StaticGate.checkFile("collision.js", "let hitB = false\nhitB = true").ok).toBe(true)
    expect(StaticGate.checkFile("mesh.js", "const api = { mesh(gl, key, make) { return make(gl, key) } }").ok).toBe(
      true,
    )
  })

  test("Browser OS EventTarget and keyword-named methods are valid; missing values still fail", () => {
    const source = [
      "const bus = new EventTarget()",
      "const cache = { get(gl, key, make) { return make(gl, key) } }",
      "class Cache { delete(key) { return key } }",
      "bus.dispatchEvent(new Event('ready'))",
    ].join("\n")
    expect(StaticGate.checkFile("cache.js", source).diagnostics).toEqual([])
    expect(
      StaticGate.checkFile("cache.js", source.replace("make(gl, key)", "make(gl, missingValue)")).diagnostics.map(
        (diagnostic) => diagnostic.symbol,
      ),
    ).toEqual(["missingValue"])
    expect(
      StaticGate.checkFile("branch.js", "if (missingCondition) { console.log('ready') }").diagnostics[0].symbol,
    ).toBe("missingCondition")
  })

  test("TypeScript annotations and JSX do not become undefined value references", () => {
    expect(
      StaticGate.checkFile("math.ts", "export function twice(value: number): number { return value * 2 }").ok,
    ).toBe(true)
    expect(StaticGate.checkFile("view.tsx", "export const View = () => <button>OK</button>").ok).toBe(true)
    expect(StaticGate.checkFile("math.ts", "export function twice(value: number) { return value + missing }").ok).toBe(
      false,
    )
  })

  test("minified scopes stay separate; undefined values still fail", () => {
    expect(
      StaticGate.checkFile(
        "vendor.min.js",
        "(()=>{function f(a){return a}console.log(f(1))})();(()=>{function f(a){return a+1}console.log(f(1))})();",
      ).ok,
    ).toBe(true)
    expect(StaticGate.checkFile("vendor.min.js", "(()=>{function f(a){return a+undef}console.log(f(1))})();").ok).toBe(
      false,
    )
  })

  test("namespace declarations, re-exports, and labeled loops are not false positives", () => {
    const source = [
      "export namespace Read { export const value = 1 }",
      "export { value as renamed } from './value'",
      "export * as Bash from './bash'",
      "outer: for (const item of []) { if (item) continue outer; break outer }",
    ].join("\n")
    expect(StaticGate.checkFile("fixture.ts", source).diagnostics).toEqual([])
  })

  test("declaration files are skipped and runtime globals are ambient", () => {
    expect(StaticGate.checkFile("types.d.ts", "declare const missingType: TextDecoderStream").analyzable).toBe(false)
    expect(
      StaticGate.checkFile(
        "runtime.ts",
        "new DOMException(); new HTMLRewriter(); const option: HTMLOptionElement = onmessage",
      ).ok,
    ).toBe(true)
  })

  test("keyword-named and anonymous generator functions declare their parameters", () => {
    const source = [
      "export function get(sessionID: string) { return sessionID }",
      "export function set(key: string, value: string) { return [key, value] }",
      "async function infer(prompt, category) { return category ?? prompt }",
      "const gen = function* ({ find }) { yield find }",
      "export const gen2 = function* ({ content, find }) { yield find ?? content }",
    ].join("\n")
    expect(StaticGate.checkFile("params.ts", source).diagnostics).toEqual([])
    expect(
      StaticGate.checkFile("params.ts", "function set(key, value) { return unknownThing }").diagnostics.map(
        (d) => d.symbol,
      ),
    ).toEqual(["unknownThing"])
  })

  test("import aliases bind only the local name, not the aliased source", () => {
    const source = [
      'import { Protocol, Protocol as WireProtocol } from "./protocol"',
      'import { Protocol as LocalProtocol } from "./other-protocol"',
      "export const use = () => [Protocol, WireProtocol, LocalProtocol]",
    ].join("\n")
    expect(StaticGate.checkFile("alias.ts", source).diagnostics).toEqual([])
  })

  test("format() renders a concise, actionable summary", () => {
    const result = StaticGate.analyze("const x = missing\nconsole.log(x)")
    expect(StaticGate.format(result, "a.js")).toContain("a.js")
    expect(StaticGate.format(result, "a.js")).toContain("no-undef")
  })
})
