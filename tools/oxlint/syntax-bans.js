const asyncMessage =
  "No async/await in Effect code — use Effect.gen. Escape hatch: an oxlint-disable comment, foreign boundaries only."
const newPromiseMessage =
  "No `new Promise` — wrap callbacks with Effect.try or Effect.async. Escape hatch: an oxlint-disable comment, foreign boundaries only."
const tryMessage =
  "No try/catch in Effect code — model failures with typed errors (Effect.catch*, Effect.die). Escape hatch: an oxlint-disable comment, foreign boundaries only."
const throwMessage =
  "No throw in Effect code — use Effect.fail or Effect.die. Escape hatch: an oxlint-disable comment, foreign boundaries only."
const jsonParseMessage =
  "No raw JSON.parse — decode with Schema (Schema.decodeUnknown*). Escape hatch: an oxlint-disable comment, foreign boundaries only."
const stubMessage =
  "No `stub()` in verified code — replace plan-skeleton `stub<A, E, R>(...)` with a real implementation before running verify."
const effectFnMessage =
  "Effect.fn must be called with a non-empty string literal span name (e.g. Effect.fn('Module.name'))."
const domainExportMessage =
  "Exported domain functions must use Effect.fn('LiteralName') for runtime trace correlation."
const fetchBanMessage =
  "Direct `fetch(...)` is banned in web app code — consume endpoints through typed AtomHttpApi queries and mutations (SampleApiClient)."

function isIdentifier(node, name) {
  return node != null && node.type === "Identifier" && node.name === name
}

function isFetchCall(node) {
  const callee = node.callee
  if (isIdentifier(callee, "fetch")) return true
  if (
    callee != null &&
    callee.type === "MemberExpression" &&
    callee.computed !== true &&
    (isIdentifier(callee.object, "globalThis") || isIdentifier(callee.object, "window")) &&
    isIdentifier(callee.property, "fetch")
  ) {
    return true
  }
  return false
}

function isNewPromise(node) {
  return isIdentifier(node.callee, "Promise")
}

function isJsonParse(node) {
  const callee = node.callee
  return (
    callee != null &&
    callee.type === "MemberExpression" &&
    callee.computed !== true &&
    isIdentifier(callee.object, "JSON") &&
    isIdentifier(callee.property, "parse")
  )
}

function isStubCall(node) {
  const callee = node.callee
  if (isIdentifier(callee, "stub")) return true
  return (
    callee != null &&
    callee.type === "MemberExpression" &&
    callee.computed !== true &&
    isIdentifier(callee.property, "stub")
  )
}

function isEffectFnCall(node) {
  const callee = node.callee
  return (
    callee != null &&
    callee.type === "MemberExpression" &&
    callee.computed !== true &&
    isIdentifier(callee.object, "Effect") &&
    isIdentifier(callee.property, "fn")
  )
}

function isEffectFnInvocation(node) {
  if (node == null || node.type !== "CallExpression") return false
  if (isEffectFnCall(node)) return true
  if (node.callee != null && node.callee.type === "CallExpression" && isEffectFnCall(node.callee)) return true
  return false
}

function isUntracedEffectCall(node) {
  if (node == null || node.type !== "CallExpression") return false
  const callee = node.callee
  if (callee == null) return false
  if (
    callee.type === "MemberExpression" &&
    callee.computed !== true &&
    isIdentifier(callee.object, "Effect") &&
    (isIdentifier(callee.property, "fnUntraced") || isIdentifier(callee.property, "gen"))
  ) {
    return true
  }
  if (
    callee.type === "CallExpression" &&
    callee.callee != null &&
    callee.callee.type === "MemberExpression" &&
    callee.callee.computed !== true &&
    isIdentifier(callee.callee.object, "Effect") &&
    isIdentifier(callee.callee.property, "fnUntraced")
  ) {
    return true
  }
  return false
}

const effectTsgoDisableMessage =
  "Suppressing `effecttsgo/*` (@effect/language-service) diagnostics with oxlint-disable is banned — fix the underlying Effect idiom violation instead."

const syntaxBans = {
  create(context) {
    function reportAsync(node) {
      if (node.async === true) {
        context.report({ node, message: asyncMessage })
      }
    }

    return {
      Program(node) {
        const text =
          context.sourceCode && typeof context.sourceCode.text === "string"
            ? context.sourceCode.text
            : ""
        if (/oxlint-disable[^\n]*effecttsgo\//.test(text)) {
          context.report({ node, message: effectTsgoDisableMessage })
        }
      },
      FunctionDeclaration: reportAsync,
      FunctionExpression: reportAsync,
      ArrowFunctionExpression: reportAsync,
      AwaitExpression(node) {
        context.report({ node, message: asyncMessage })
      },
      NewExpression(node) {
        if (isNewPromise(node)) {
          context.report({ node, message: newPromiseMessage })
        }
      },
      TryStatement(node) {
        context.report({ node, message: tryMessage })
      },
      ThrowStatement(node) {
        context.report({ node, message: throwMessage })
      },
      CallExpression(node) {
        if (isJsonParse(node)) {
          context.report({ node, message: jsonParseMessage })
        }
        if (process.env.HARNESS_PLAN_CHECK !== "1" && isStubCall(node)) {
          context.report({ node, message: stubMessage })
        }
        if (isEffectFnCall(node)) {
          const arg0 = node.arguments[0]
          if (
            node.arguments.length === 0 ||
            arg0 == null ||
            arg0.type !== "Literal" ||
            typeof arg0.value !== "string" ||
            arg0.value.trim() === ""
          ) {
            context.report({ node, message: effectFnMessage })
          }
        }
        const filename = (context.filename ?? (typeof context.getFilename === "function" ? context.getFilename() : "")).replace(/\\/g, "/")
        if (filename.includes("sample-web/src/") && isFetchCall(node)) {
          context.report({ node, message: fetchBanMessage })
        }
      },
      ExportNamedDeclaration(node) {
        const filename = context.filename ? context.filename.replace(/\\/g, "/") : ""
        if (!/libs\/sample\/(domain|service|infra)\/src\//.test(filename)) return
        if (node.declaration == null) return

        if (node.declaration.type === "FunctionDeclaration") {
          context.report({ node: node.declaration, message: domainExportMessage })
          return
        }

        if (node.declaration.type === "VariableDeclaration") {
          const isDomain = filename.includes("libs/sample/domain/src/")
          for (const decl of node.declaration.declarations) {
            const init = decl.init
            if (init == null) continue
            if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") {
              context.report({ node: decl, message: domainExportMessage })
            } else if (init.type === "CallExpression") {
              if (isUntracedEffectCall(init) || (isDomain && !isEffectFnInvocation(init))) {
                context.report({ node: decl, message: domainExportMessage })
              }
            }
          }
        }
      },
    }
  },
}

export default {
  meta: {
    name: "harness",
  },
  rules: {
    "syntax-bans": syntaxBans,
  },
}
