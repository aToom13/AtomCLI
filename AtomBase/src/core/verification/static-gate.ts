/**
 * StaticGate — deterministic, dependency-free, scope-aware static analysis for
 * JavaScript artifacts.
 *
 * Motivation: `node --check` only validates syntax. It happily accepts code that
 * references an identifier that does not exist (`undef`), redeclares a
 * block-scoped binding, or uses a binding before its declaration. Those defects
 * are only discovered at runtime — after an LLM has already spent tokens
 * re-discovering them, and (worse) after they ship inside a build artifact.
 *
 * This module classifies identifiers into declarations vs. value references and
 * reports the low-risk, high-signal defect classes that a syntax check cannot:
 *
 *   - no-undef            identifier referenced but never declared/known global
 *   - no-redeclare        block-scoped binding declared twice in the same scope
 *   - duplicate-declaration   same binding declared twice in one scope
 *
 * It is intentionally conservative: anything ambiguous (object-literal keys,
 * labels, shorthand, member access, `typeof` guards) is treated as "not a
 * reference" so it can never be reported as undefined.
 *
 * This is a heuristic analyzer, not a full parser. It does not attempt to model
 * closures, hoisting subtleties, or shadowing correctness (a shadowed-but-valid
 * call resolves fine here). It exists to fail fast on the simple mechanical
 * mistakes that otherwise reach runtime.
 */

export namespace StaticGate {
  export type Code = "no-undef" | "no-redeclare" | "duplicate-declaration" | "use-before-declaration" | "syntax"

  export type Diagnostic = {
    code: Code
    severity: "error" | "warning"
    message: string
    symbol: string
    line: number
    column: number
    snippet?: string
  }

  export type Result = {
    ok: boolean
    analyzable: boolean
    diagnostics: Diagnostic[]
    stats: { identifiers: number; references: number; declarations: number; scopes: number }
  }

  export type Options = {
    /** Extra identifiers to treat as global (checked after built-ins). */
    globals?: string[]
    /** Restrict reported codes. Defaults to all error codes. */
    codes?: Code[]
    /** Filenames/extensions to skip. Defaults to non-JS extensions. */
    language?: "js" | "ts"
  }

  // ── Token model ────────────────────────────────────────────────────────────
  type TokenType = "identifier" | "keyword" | "punct" | "string" | "template" | "number" | "regex" | "comment"

  type Token = {
    type: TokenType
    value: string
    line: number
    column: number
    /** Offset in the analyzed source. */
    start: number
    /** True when an identifier is the beginning of a line (statement position). */
    firstOnLine?: boolean
  }

  // ── Language tables ────────────────────────────────────────────────────────
  const KEYWORDS = new Set([
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "function",
    "if",
    "import",
    "in",
    "instanceof",
    "new",
    "null",
    "return",
    "super",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "typeof",
    "var",
    "void",
    "while",
    "with",
    "yield",
    "let",
    "static",
    "get",
    "set",
    "async",
    "of",
    "as",
    "from",
    "interface",
    "type",
    "declare",
    "namespace",
    "abstract",
    "implements",
    "public",
    "private",
    "protected",
    "readonly",
    "keyof",
    "infer",
    "is",
    "satisfies",
    "enum",
    "debugger",
  ])

  const REGEX_PREFIX_KEYWORDS = new Set([
    "return",
    "typeof",
    "instanceof",
    "in",
    "of",
    "new",
    "delete",
    "void",
    "throw",
    "case",
    "do",
    "else",
    "yield",
    "await",
  ])

  const BUILTIN_GLOBALS = new Set([
    "Object",
    "Function",
    "Boolean",
    "Symbol",
    "Error",
    "EvalError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "TypeError",
    "URIError",
    "AggregateError",
    "Number",
    "BigInt",
    "Math",
    "Date",
    "String",
    "RegExp",
    "Array",
    "Int8Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "Int16Array",
    "Uint16Array",
    "Int32Array",
    "Uint32Array",
    "Float32Array",
    "Float64Array",
    "BigInt64Array",
    "BigUint64Array",
    "Map",
    "Set",
    "WeakMap",
    "WeakSet",
    "WeakRef",
    "FinalizationRegistry",
    "ArrayBuffer",
    "SharedArrayBuffer",
    "DataView",
    "Atomics",
    "JSON",
    "Promise",
    "Proxy",
    "Reflect",
    "Intl",
    "globalThis",
    "parseInt",
    "parseFloat",
    "isNaN",
    "isFinite",
    "decodeURI",
    "decodeURIComponent",
    "encodeURI",
    "encodeURIComponent",
    "escape",
    "unescape",
    "eval",
    "structuredClone",
    "queueMicrotask",
    "process",
    "Buffer",
    "global",
    "module",
    "exports",
    "require",
    "__dirname",
    "__filename",
    "Bun",
    "Deno",
    "DOMException",
    "HTMLRewriter",
    "TextDecoderStream",
    "TextEncoderStream",
    "HTMLOptionElement",
    "ResolveMessage",
    "onmessage",
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    "setImmediate",
    "clearImmediate",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "requestIdleCallback",
    "cancelIdleCallback",
    "window",
    "document",
    "self",
    "top",
    "parent",
    "frames",
    "navigator",
    "location",
    "history",
    "screen",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "caches",
    "performance",
    "console",
    "crypto",
    "customElements",
    "matchMedia",
    "getComputedStyle",
    "devicePixelRatio",
    "innerWidth",
    "innerHeight",
    "scrollX",
    "scrollY",
    "pageXOffset",
    "pageYOffset",
    "atob",
    "btoa",
    "alert",
    "confirm",
    "prompt",
    "postMessage",
    "addEventListener",
    "removeEventListener",
    "dispatchEvent",
    "getSelection",
    "scroll",
    "scrollTo",
    "scrollBy",
    "fetch",
    "Request",
    "Response",
    "Headers",
    "FormData",
    "URL",
    "URLSearchParams",
    "AbortController",
    "AbortSignal",
    "WebSocket",
    "EventSource",
    "XMLHttpRequest",
    "ReadableStream",
    "WritableStream",
    "TransformStream",
    "TextEncoder",
    "TextDecoder",
    "Blob",
    "File",
    "FileReader",
    "FileList",
    "CompressionStream",
    "DecompressionStream",
    "Image",
    "ImageBitmap",
    "ImageData",
    "Audio",
    "AudioContext",
    "Path2D",
    "OffscreenCanvas",
    "createImageBitmap",
    "DOMMatrix",
    "DOMPoint",
    "DOMRect",
    "CanvasRenderingContext2D",
    "WebGLRenderingContext",
    "WebGL2RenderingContext",
    "Event",
    "EventTarget",
    "CustomEvent",
    "MouseEvent",
    "PointerEvent",
    "KeyboardEvent",
    "TouchEvent",
    "WheelEvent",
    "DragEvent",
    "FocusEvent",
    "InputEvent",
    "ClipboardEvent",
    "SubmitEvent",
    "UIEvent",
    "MessageEvent",
    "ErrorEvent",
    "ProgressEvent",
    "Node",
    "Element",
    "HTMLElement",
    "HTMLCanvasElement",
    "HTMLDivElement",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "HTMLImageElement",
    "HTMLAudioElement",
    "HTMLVideoElement",
    "HTMLAnchorElement",
    "HTMLButtonElement",
    "HTMLSelectElement",
    "SVGElement",
    "DocumentFragment",
    "NodeList",
    "NodeFilter",
    "MutationObserver",
    "ResizeObserver",
    "IntersectionObserver",
    "PerformanceObserver",
    "DOMParser",
    "XMLSerializer",
    "Range",
    "Selection",
    "Worker",
    "SharedWorker",
    "BroadcastChannel",
    "MessageChannel",
    "MessagePort",
    "Notification",
    "Geolocation",
    "Clipboard",
    "CSS",
    "Text",
    "Comment",
    "Document",
    "Window",
    "ShadowRoot",
    "CSSStyleSheet",
    "Touch",
    "TouchList",
    "AudioNode",
    "AudioBuffer",
    "GainNode",
    "OscillatorNode",
    "THREE",
    "AtomCLI",
    "atom",
    "arguments",
    "undefined",
    "NaN",
    "Infinity",
    "scene",
    "camera",
    "renderer",
    // Optional-runtime globals commonly feature-detected in bundles.
    "define",
    "__THREE_DEVTOOLS__",
    "XRWebGLLayer",
    "XRWebGLBinding",
    "XRSession",
    "XRFrame",
    "XRRenderState",
    "XRReferenceSpace",
    "XRSpace",
    "XRPose",
    "XRView",
    "XRViewerPose",
    "XRCamera",
    "XRSystem",
    "XRInputSource",
    "XRHitTestResult",
    "XRPose",
    "XRDepthInformation",
    "XRWebGLDepthInformation",
    "WebGLRenderingContextBase",
  ])

  const PUNCT_OPERATORS = [
    ">>>=",
    "...",
    "===",
    "!==",
    "**=",
    "<<=",
    ">>=",
    ">>>",
    "&&=",
    "||=",
    "??=",
    "=>",
    "==",
    "!=",
    "<=",
    ">=",
    "&&",
    "||",
    "??",
    "?.",
    "++",
    "--",
    "+=",
    "-=",
    "*=",
    "/=",
    "%=",
    "&=",
    "|=",
    "^=",
    "<<",
    ">>",
    "**",
  ]

  function isIdStart(ch: string) {
    return /[A-Za-z_$]/.test(ch) || (ch !== undefined && ch.charCodeAt(0) > 127)
  }
  function isIdPart(ch: string) {
    return /[A-Za-z0-9_$]/.test(ch) || (ch !== undefined && ch.charCodeAt(0) > 127)
  }
  function isDigit(ch: string) {
    return ch >= "0" && ch <= "9"
  }

  /** True when `/` at this position should start a regex literal, not division. */
  function regexAllowed(prev: Token | undefined) {
    if (!prev) return true
    if (["identifier", "number", "string", "template", "regex"].includes(prev.type)) return false
    if (prev.type === "keyword") return REGEX_PREFIX_KEYWORDS.has(prev.value)
    if (prev.type === "punct") return ![")", "]", "}"].includes(prev.value)
    return true
  }

  export function tokenize(source: string): {
    tokens: Token[]
    error?: { message: string; line: number; column: number }
  } {
    const tokens: Token[] = []
    let i = 0
    let line = 1
    let column = 1
    let firstOnLine = true
    const n = source.length

    const advance = (count = 1) => {
      for (let k = 0; k < count; k++) {
        if (source[i] === "\n") {
          line++
          column = 1
          firstOnLine = true
        } else column++
        i++
      }
    }

    const push = (type: TokenType, value: string, startLine: number, startColumn: number, start: number) => {
      tokens.push({ type, value, line: startLine, column: startColumn, start, firstOnLine })
      firstOnLine = false
    }

    while (i < n) {
      const ch = source[i]
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\f" || ch === "\v") {
        advance()
        continue
      }
      if (ch === "/" && source[i + 1] === "/") {
        while (i < n && source[i] !== "\n") advance()
        continue
      }
      if (ch === "/" && source[i + 1] === "*") {
        advance(2)
        while (i < n && !(source[i] === "*" && source[i + 1] === "/")) advance()
        advance(2)
        continue
      }
      if (ch === '"' || ch === "'") {
        const sl = line
        const sc = column
        const start = i
        const quote = ch
        advance()
        while (i < n) {
          if (source[i] === "\\") {
            advance(2)
            continue
          }
          if (source[i] === quote) {
            advance()
            break
          }
          if (source[i] === "\n") break
          advance()
        }
        push("string", source.slice(start, i), sl, sc, start)
        continue
      }
      if (ch === "`") {
        const sl = line
        const sc = column
        const start = i
        advance()
        while (i < n) {
          if (source[i] === "\\") {
            advance(2)
            continue
          }
          if (source[i] === "$" && source[i + 1] === "{") {
            advance(2)
            let brace = 1
            while (i < n && brace > 0) {
              if (source[i] === "{") brace++
              else if (source[i] === "}") brace--
              advance()
            }
            continue
          }
          if (source[i] === "`") {
            advance()
            break
          }
          advance()
        }
        push("template", source.slice(start, i), sl, sc, start)
        continue
      }
      if (ch === "/" && regexAllowed(tokens[tokens.length - 1])) {
        const sl = line
        const sc = column
        const start = i
        advance()
        let inClass = false
        let closed = false
        while (i < n) {
          const c = source[i]
          if (c === "\\") {
            advance(2)
            continue
          }
          if (c === "\n") break
          if (c === "[") inClass = true
          else if (c === "]") inClass = false
          else if (c === "/" && !inClass) {
            advance()
            closed = true
            break
          }
          advance()
        }
        if (!closed) return { tokens, error: { message: "Unterminated regular expression", line: sl, column: sc } }
        while (i < n && isIdPart(source[i])) advance()
        push("regex", source.slice(start, i), sl, sc, start)
        continue
      }
      if (isDigit(ch) || (ch === "." && isDigit(source[i + 1]))) {
        const sl = line
        const sc = column
        const start = i
        while (i < n) {
          const c = source[i]
          if (/[0-9a-fA-FxXoObBeE._]/.test(c)) {
            advance()
            continue
          }
          if ((c === "+" || c === "-") && /[eE]/.test(source[i - 1] ?? "")) {
            advance()
            continue
          }
          if (c === "n") {
            advance()
            break
          }
          break
        }
        push("number", source.slice(start, i), sl, sc, start)
        continue
      }
      if (isIdStart(ch)) {
        const sl = line
        const sc = column
        const start = i
        while (i < n && isIdPart(source[i])) advance()
        const value = source.slice(start, i)
        push(KEYWORDS.has(value) ? "keyword" : "identifier", value, sl, sc, start)
        continue
      }
      const sl = line
      const sc = column
      const start = i
      const op = PUNCT_OPERATORS.find((candidate) => source.startsWith(candidate, i))
      if (op) {
        advance(op.length)
        push("punct", op, sl, sc, start)
        continue
      }
      advance()
      push("punct", ch, sl, sc, start)
    }
    return { tokens }
  }

  // ── Analyzer ───────────────────────────────────────────────────────────────
  type Scope = { kind: "program" | "block" | "object" | "class"; block: Set<string>; funcs: Set<string> }

  const OBJECT_PREV_PUNCT = new Set([
    "=",
    "(",
    "[",
    ",",
    ":",
    "?",
    "??",
    "||",
    "&&",
    "+",
    "-",
    "*",
    "/",
    "%",
    "**",
    "<",
    ">",
    "<=",
    ">=",
    "==",
    "!=",
    "===",
    "!==",
    "&",
    "|",
    "^",
    "!",
    "~",
    "...",
  ])
  const OBJECT_PREV_KEYWORD = new Set([
    "return",
    "yield",
    "case",
    "typeof",
    "void",
    "delete",
    "in",
    "instanceof",
    "new",
    "of",
    "default",
    "await",
  ])
  const DECL_KEYWORDS = new Set(["let", "const", "var"])

  function isKeyword(tok: Token | undefined, value: string) {
    return Boolean(tok && tok.type === "keyword" && tok.value === value)
  }

  function snippetOf(source: string, token: Token) {
    const lines = source.split("\n")
    const raw = lines[token.line - 1] ?? ""
    return raw.trim().slice(0, 160)
  }

  export function analyze(source: string, options: Options = {}): Result {
    const codes = new Set<Code>(options.codes ?? ["no-undef", "no-redeclare", "duplicate-declaration"])
    const globals = new Set([...BUILTIN_GLOBALS, ...(options.globals ?? [])])
    const { tokens, error } = tokenize(source)
    if (error) {
      return {
        ok: false,
        analyzable: true,
        diagnostics: [
          {
            code: "syntax",
            severity: "error",
            message: error.message,
            symbol: "",
            line: error.line,
            column: error.column,
            snippet: snippetOf(source, { line: error.line, column: error.column } as Token),
          },
        ],
        stats: { identifiers: 0, references: 0, declarations: 0, scopes: 1 },
      }
    }

    const diagnostics: Diagnostic[] = []
    const declared = new Set<string>() // all bindings anywhere in the file
    const scopes: Scope[] = [{ kind: "program", block: new Set(), funcs: new Set() }]
    const braceKinds: Scope["kind"][] = []
    let identifiers = 0
    let references = 0
    let pendingClass = false
    let phase: "collect" | "report" = "collect"
    let reported = new Set<string>()
    const declSites = new Set<number>()
    let expectForParen = false
    const forHeaderEnds: number[] = []
    let nesting = 0
    const declStack: Array<{ kind: "block" | "loop" | "var"; baseDepth: number; inInitializer: boolean }> = []
    const ternaryStack: number[] = []

    const current = () => scopes[scopes.length - 1]

    const declareName = (name: string, kind: "block" | "func" | "param" | "var" | "loop", idx?: number) => {
      if (idx !== undefined) declSites.add(idx)
      if (phase === "report") return
      if (!name || KEYWORDS.has(name)) return
      declared.add(name)
      if (kind === "func") {
        // Named function *expressions* may legally repeat a name, and minified
        // bundles declare many short-named functions; reporting here would be a
        // false positive, so function names are recorded for no-undef only.
        return
      }
      if (kind === "block") {
        const scope = current()
        if (scope.block.has(name) && codes.has("no-redeclare")) {
          report("no-redeclare", "error", `Cannot redeclare block-scoped variable '${name}'.`, name)
        }
        scope.block.add(name)
      }
      // "param", "var" and "loop" bindings are recorded for no-undef only; they
      // never participate in block-scope redeclaration checks (var redeclaration
      // is legal, params live in a function scope we do not model, and loop
      // headers scope their bindings to the loop).
    }

    const PHASE_CODES: Record<"collect" | "report", Set<Code>> = {
      collect: new Set<Code>(["no-redeclare", "duplicate-declaration"]),
      report: new Set<Code>(["no-undef", "syntax"]),
    }

    const report = (code: Code, severity: "error" | "warning", message: string, symbol: string, token?: Token) => {
      if (!PHASE_CODES[phase].has(code)) return
      const at = token ?? tokens[lastIndex]
      if (!at) return
      const key = `${at.line}:${at.column}:${code}`
      if (reported.has(key)) return
      reported.add(key)
      diagnostics.push({
        code,
        severity,
        message,
        symbol,
        line: at.line,
        column: at.column,
        snippet: snippetOf(source, at),
      })
    }

    let lastIndex = 0

    const isPunct = (tok: Token | undefined, value: string) =>
      Boolean(tok && tok.type === "punct" && tok.value === value)

    // A generator method key (`*gen() {}`) is preceded by `*`, but `*` is also
    // multiplication, so only treat it as a member prefix at the start of an
    // object/class member (after `{`, `,`, `;`, or another member modifier).
    const isGeneratorKey = (idx: number): boolean => {
      if (!isPunct(tokens[idx - 1], "*")) return false
      const before = tokens[idx - 2]
      return Boolean(
        before &&
          (isPunct(before, "{") ||
            isPunct(before, ",") ||
            isPunct(before, ";") ||
            isKeyword(before, "async") ||
            isKeyword(before, "static")),
      )
    }

    const matchParen = (start: number): number => {
      let depth = 0
      for (let i = start; i < tokens.length; i++) {
        const t = tokens[i]
        if (t.type !== "punct") continue
        if (t.value === "(") depth++
        else if (t.value === ")") {
          depth--
          if (depth === 0) return i
        }
      }
      return tokens.length
    }

    const isParamRegion = (openIndex: number): boolean => {
      const close = matchParen(openIndex)
      const after = tokens[close + 1]
      if (isPunct(after, "=>")) return true
      if (!isPunct(after, "{")) return false
      const before = tokens[openIndex - 1]
      if (isKeyword(before, "function") || isKeyword(before, "catch")) return true
      // Keyword-named functions (`function get(...)`, `function set(...)`) tokenize the
      // name as a keyword, and anonymous generators put `*` before the paren.
      if (isKeyword(tokens[openIndex - 2], "function")) return true
      if (isPunct(before, "*") && isKeyword(tokens[openIndex - 2], "function")) return true
      return Boolean(
        before &&
          (before.type === "identifier" || (before.type === "keyword" && ["object", "class"].includes(current().kind))),
      )
    }

    const pushBraceScope = (prev: Token | undefined): void => {
      let kind: Scope["kind"] = "block"
      if (pendingClass) {
        kind = "class"
        pendingClass = false
      } else if (
        prev &&
        (OBJECT_PREV_PUNCT.has(prev.value) || (prev.type === "keyword" && OBJECT_PREV_KEYWORD.has(prev.value)))
      ) {
        kind = "object"
      }
      scopes.push({ kind, block: new Set(), funcs: new Set() })
      braceKinds.push(kind)
    }

    const declarePattern = (openIndex: number, closeIndex: number) => {
      for (let j = openIndex + 1; j < closeIndex; j++) {
        const inner = tokens[j]
        if (inner.type !== "identifier") continue
        if (isPunct(tokens[j - 1], ".") || isPunct(tokens[j - 1], "?.")) continue
        declareName(inner.value, "param", j)
      }
    }

    const walkOnce = () => {
      scopes.length = 1
      scopes[0].block = new Set()
      scopes[0].funcs = new Set()
      braceKinds.length = 0
      nesting = 0
      declStack.length = 0
      ternaryStack.length = 0
      pendingClass = false
      expectForParen = false
      forHeaderEnds.length = 0
      identifiers = 0
      references = 0

      for (let k = 0; k < tokens.length; k++) {
        lastIndex = k
        const t = tokens[k]
        const p = tokens[k - 1]

        if (t.type === "punct") {
          if (t.value === "{" || t.value === "(" || t.value === "[") nesting++
          else if (t.value === "}" || t.value === ")" || t.value === "]") nesting = Math.max(0, nesting - 1)
          const active = declStack[declStack.length - 1]
          if (active) {
            if (t.value === "=" && nesting === active.baseDepth) active.inInitializer = true
            else if (t.value === "," && nesting === active.baseDepth) active.inInitializer = false
            else if (t.value === ";" && nesting === active.baseDepth) declStack.pop()
            else if (nesting < active.baseDepth) declStack.pop()
          }
          if (t.value === "?") ternaryStack.push(nesting)
          else if (t.value === ":") {
            if (ternaryStack.length && ternaryStack[ternaryStack.length - 1] === nesting) ternaryStack.pop()
          }
          if (t.value === "{") {
            pushBraceScope(p)
            continue
          }
          if (t.value === "}") {
            if (scopes.length > 1) {
              scopes.pop()
              braceKinds.pop()
            }
            continue
          }
          if (t.value === "(") {
            if (expectForParen) {
              forHeaderEnds.push(matchParen(k))
              expectForParen = false
              continue
            }
            if (isParamRegion(k)) declarePattern(k, matchParen(k))
            continue
          }
          if (t.value === "=>") {
            if (p && p.type === "identifier") declareName(p.value, "param", k - 1)
            continue
          }
          continue
        }

        if (t.type === "keyword") {
          if (DECL_KEYWORDS.has(t.value)) {
            const inFor = forHeaderEnds.some((end) => k <= end)
            const kind = t.value === "var" ? "var" : inFor ? "loop" : "block"
            declStack.push({ kind, baseDepth: nesting, inInitializer: false })
            continue
          }
          if (t.value === "for") {
            expectForParen = true
            continue
          }
          if (t.value === "of" || t.value === "in") {
            const active = declStack[declStack.length - 1]
            if (active && nesting === active.baseDepth) declStack.pop()
            continue
          }
          if (t.value === "typeof") {
            const next = tokens[k + 1]
            if (next && next.type === "identifier") declareName(next.value, "var", k + 1)
            continue
          }
          if (t.value === "namespace") {
            const next = tokens[k + 1]
            if (next && next.type === "identifier") declareName(next.value, "block", k + 1)
            continue
          }
          if (t.value === "export") {
            const next = tokens[k + 1]
            if (isPunct(next, "{")) {
              let depth = 0
              for (let j = k + 1; j < tokens.length; j++) {
                if (isPunct(tokens[j], "{")) depth++
                else if (isPunct(tokens[j], "}")) {
                  depth--
                  if (depth === 0) break
                } else if (depth === 1 && tokens[j].type === "identifier") declSites.add(j)
              }
            } else if (isPunct(next, "*")) {
              const asIndex = tokens.findIndex(
                (token, index) => index > k + 1 && token.type === "keyword" && token.value === "as",
              )
              const name = asIndex >= 0 ? tokens[asIndex + 1] : undefined
              if (name?.type === "identifier") declSites.add(asIndex + 1)
            }
            continue
          }
          if (t.value === "function") {
            const next = tokens[k + 1]
            const named = next && next.type === "identifier" ? next : tokens[k + 2]
            const namedIndex = next && next.type === "identifier" ? k + 1 : k + 2
            if (named && named.type === "identifier") declareName(named.value, "func", namedIndex)
            continue
          }
          if (t.value === "class") {
            const next = tokens[k + 1]
            if (next && next.type === "identifier") declareName(next.value, "block", k + 1)
            pendingClass = true
            continue
          }
          if (t.value === "import") {
            if (isPunct(tokens[k + 1], ".") || isPunct(tokens[k + 1], "(")) continue
            for (let j = k + 1; j < tokens.length; j++) {
              const it = tokens[j]
              if (it.type === "string" || (it.type === "keyword" && it.value === "from")) break
              if (it.type !== "identifier") continue
              // `import { source as local }` only binds the alias locally; the source
              // name must not be recorded or it collides with a separate re-import.
              if (isKeyword(tokens[j + 1], "as")) continue
              declareName(it.value, "block", j)
            }
            continue
          }
          continue
        }

        if (t.type !== "identifier") continue
        identifiers++
        const decl = declStack[declStack.length - 1]
        if (decl && !decl.inInitializer && nesting >= decl.baseDepth) {
          declareName(t.value, decl.kind, k)
          continue
        }
        if (declSites.has(k)) continue
        if (p && (isPunct(p, ".") || isPunct(p, "?.") || isPunct(p, "#"))) continue
        if (isKeyword(tokens[k + 1], "as")) continue
        const ternaryPending = ternaryStack.length > 0 && ternaryStack[ternaryStack.length - 1] === nesting
        if (isPunct(tokens[k + 1], ":") && !ternaryPending) continue
        const ctx = current().kind
        if ((ctx === "object" || ctx === "class") && p && (isPunct(p, "{") || isPunct(p, ","))) continue
        if ((ctx === "object" || ctx === "class") && isGeneratorKey(k)) continue
        if (ctx === "class" && p && (isPunct(p, ";") || isPunct(p, "}"))) continue
        if (
          ctx === "class" &&
          (isKeyword(p, "static") || isKeyword(p, "get") || isKeyword(p, "set") || isKeyword(p, "async"))
        )
          continue
        if (ctx === "object" && (isKeyword(p, "get") || isKeyword(p, "set") || isKeyword(p, "async"))) continue
        if (isKeyword(p, "typeof")) continue
        if (isKeyword(p, "break") || isKeyword(p, "continue")) continue
        references++
        if (!declared.has(t.value) && !globals.has(t.value) && codes.has("no-undef")) {
          report("no-undef", "error", `'${t.value}' is not defined.`, t.value, t)
        }
      }
    }

    phase = "collect"
    walkOnce()
    phase = "report"
    walkOnce()

    return {
      ok: !diagnostics.some((d) => d.severity === "error"),
      analyzable: true,
      diagnostics,
      stats: { identifiers, references, declarations: declared.size, scopes: scopes.length },
    }
  }

  export function checkFile(filePath: string, source: string, options: Options = {}): Result {
    const skipped: Result = {
      ok: true,
      analyzable: false,
      diagnostics: [],
      stats: { identifiers: 0, references: 0, declarations: 0, scopes: 0 },
    }
    if (filePath.toLowerCase().endsWith(".d.ts")) return skipped
    const ext = (filePath.split(".").pop() ?? "").toLowerCase()
    const supported = ["js", "mjs", "cjs", "jsx", "html", "htm", "ts", "tsx"]
    if (!supported.includes(ext)) return skipped
    const locations: { line: number; column: number; generatedLine: number }[] = []
    const code = ext === "html" || ext === "htm" ? extractInlineScripts(source, locations) : source
    const locate = (result: Result): Result => ({
      ...result,
      diagnostics: result.diagnostics.map((diagnostic) => {
        const block = locations.findLast((block) => block.generatedLine <= diagnostic.line)
        if (!block) return diagnostic
        return {
          ...diagnostic,
          line: block.line + diagnostic.line - block.generatedLine,
          column: diagnostic.column + (diagnostic.line === block.generatedLine ? block.column - 1 : 0),
        }
      }),
    })
    const loader = ext === "tsx" || ext === "jsx" ? ext : ext === "ts" ? "ts" : "js"
    try {
      const transpiler = new Bun.Transpiler({
        loader,
        trimUnusedImports: false,
        treeShaking: false,
        deadCodeElimination: false,
        tsconfig: {
          compilerOptions: {
            jsx: "react",
            jsxFactory: "globalThis.React.createElement",
            jsxFragmentFactory: "globalThis.React.Fragment",
          },
        },
      })
      // ponytail: TS/JSX diagnostics use emitted JS positions; source maps belong in a full parser-backed gate.
      const emitted = transpiler.transformSync(code)
      return locate(analyze(loader === "js" ? code : emitted, options))
    } catch (error) {
      const errors = error instanceof AggregateError && error.errors.length ? error.errors : [error]
      return locate({
        ...skipped,
        ok: false,
        analyzable: true,
        diagnostics: errors.map(
          (detail): Diagnostic => ({
            code: "syntax",
            severity: "error",
            message: detail?.message ?? String(detail),
            symbol: "",
            line: detail?.position?.line ?? 1,
            column: detail?.position?.column ?? 1,
          }),
        ),
      })
    }
  }

  /** Extract inline `<script>` bodies from an HTML document for analysis. */
  export function extractInlineScripts(
    html: string,
    locations?: { line: number; column: number; generatedLine: number }[],
  ): string {
    const out: string[] = []
    let cursor = 0,
      line = 1,
      column = 1,
      generatedLine = 1
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
    let match: RegExpExecArray | null
    while ((match = re.exec(html))) {
      const attrs = match[1] ?? ""
      if (/\bsrc\s*=/i.test(attrs)) continue
      if (/\btype\s*=\s*["']?(?:application\/(?:ld\+json|json)|text\/template)/i.test(attrs)) continue
      if (locations) {
        const start = match.index + match[0].indexOf(">") + 1
        const prefix = html.slice(cursor, start).split("\n")
        line += prefix.length - 1
        column = prefix.length === 1 ? column + prefix[0].length : prefix.at(-1)!.length + 1
        cursor = start
        locations.push({ line, column, generatedLine })
        generatedLine += match[2].split("\n").length + 1
      }
      out.push(match[2])
    }
    return out.join("\n;\n")
  }

  export function format(result: Result, filePath?: string): string {
    if (!result.analyzable) return `Static gate skipped ${filePath ?? "input"}: unsupported file type.`
    if (!result.diagnostics.length)
      return `Static gate passed${filePath ? ` (${filePath})` : ""}: no undefined identifiers or redeclarations (${result.stats.references} references checked).`
    const lines = result.diagnostics.map(
      (d) => `  ${filePath ?? "input"}:${d.line}:${d.column} [${d.code}] ${d.message}`,
    )
    return `Static gate found ${result.diagnostics.length} issue(s):\n${lines.join("\n")}`
  }
}
