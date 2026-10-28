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
const secretConfigMessage =
  "Sensitive configuration keys (SECRET, TOKEN, PASSWORD, API_KEY, PRIVATE_KEY, CREDENTIAL) must use Config.redacted(...) instead of Config.string(...) to prevent leaking secrets in logs and spans."
const sqlInterpolationMessage =
  "Raw SQL template interpolation in .exec(`...${...}`) or .prepare(`...${...}`) is banned (SQL injection risk) — use parameterized queries or Drizzle ORM."
const impureDomainGlobalMessage =
  "Impure global Date.now() / new Date() / Math.random() is banned in type:domain — pass timestamps/randomness via input or use Effect Clock / Random services so domain deciders remain deterministic."
const foreverRetryMessage =
  "Unbounded Effect.retry with Schedule.forever is banned (retry storm risk) — bound retries with Schedule.recurs(n) or Schedule.upTo(duration)."
const domainEffectIgnoreMessage =
  "Swallowing typed errors with Effect.ignore is banned in type:domain — surface failures in the E channel or handle them explicitly."

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

function isSecretConfigCall(node) {
  if (node == null || node.type !== "CallExpression") return false
  const callee = node.callee
  if (
    callee != null &&
    callee.type === "MemberExpression" &&
    callee.computed !== true &&
    isIdentifier(callee.object, "Config") &&
    (isIdentifier(callee.property, "string") || isIdentifier(callee.property, "nonEmptyString"))
  ) {
    const arg0 = node.arguments[0]
    if (
      arg0 != null &&
      arg0.type === "Literal" &&
      typeof arg0.value === "string" &&
      /(SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY|CREDENTIAL)/i.test(arg0.value)
    ) {
      return true
    }
  }
  return false
}

function isSqlInterpolationCall(node) {
  if (node == null || node.type !== "CallExpression") return false
  const callee = node.callee
  if (
    callee != null &&
    callee.type === "MemberExpression" &&
    callee.computed !== true &&
    (isIdentifier(callee.property, "exec") || isIdentifier(callee.property, "prepare"))
  ) {
    const arg0 = node.arguments[0]
    if (
      arg0 != null &&
      arg0.type === "TemplateLiteral" &&
      Array.isArray(arg0.expressions) &&
      arg0.expressions.length > 0
    ) {
      return true
    }
  }
  return false
}

function hasScheduleForever(node) {
  if (node == null || typeof node !== "object") return false
  if (
    node.type === "MemberExpression" &&
    node.computed !== true &&
    isIdentifier(node.object, "Schedule") &&
    isIdentifier(node.property, "forever")
  ) {
    return true
  }
  for (const key of Object.keys(node)) {
    if (key === "parent") continue
    const val = node[key]
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item != null && typeof item === "object" && item.type) {
          if (hasScheduleForever(item)) return true
        }
      }
    } else if (val != null && typeof val === "object" && val.type) {
      if (hasScheduleForever(val)) return true
    }
  }
  return false
}

function isEffectRetryCall(node) {
  if (node == null || node.type !== "CallExpression") return false
  const callee = node.callee
  if (
    callee != null &&
    callee.type === "MemberExpression" &&
    callee.computed !== true &&
    isIdentifier(callee.object, "Effect") &&
    isIdentifier(callee.property, "retry")
  ) {
    return true
  }
  return false
}

const effectTsgoDisableMessage =
  "Suppressing `effecttsgo/*` (@effect/language-service) or `harness/*` diagnostics with oxlint-disable/eslint-disable/@effect-diagnostics is banned — fix the underlying violation instead."
const tsSuppressionMessage =
  "TypeScript suppression directives (@ts-ignore, @ts-expect-error, @ts-nocheck) are banned in production source files — fix the underlying type error instead."
const testTsIgnoreMessage =
  "Unconditional TypeScript suppression (@ts-ignore, @ts-nocheck) is banned in tests — fix the types or use @ts-expect-error with an explanation for negative type tests."
const testSkipOrOnlyMessage =
  "Skipping or focusing tests (.skip, .only, .todo) is banned by Three-Layer Test Defence (E4 §3) — fix the failing test or implementation instead of bypassing verification."

function isTestRunnerTarget(node) {
  if (node == null) return false
  if (
    node.type === "Identifier" &&
    (node.name === "it" ||
      node.name === "test" ||
      node.name === "describe" ||
      node.name === "suite" ||
      node.name === "vitest")
  ) {
    return true
  }
  if (node.type === "MemberExpression" && node.computed !== true) {
    return isTestRunnerTarget(node.object)
  }
  return false
}

function isSkippedOrFocusedTestCall(node) {
  if (node == null || node.type !== "CallExpression") return false
  const callee = node.callee
  if (
    callee != null &&
    callee.type === "MemberExpression" &&
    callee.computed !== true &&
    (isIdentifier(callee.property, "skip") ||
      isIdentifier(callee.property, "only") ||
      isIdentifier(callee.property, "todo") ||
      isIdentifier(callee.property, "skipIf") ||
      isIdentifier(callee.property, "runIf")) &&
    isTestRunnerTarget(callee.object)
  ) {
    return true
  }
  if (
    isIdentifier(callee, "xit") ||
    isIdentifier(callee, "xtest") ||
    isIdentifier(callee, "xdescribe") ||
    isIdentifier(callee, "fit") ||
    isIdentifier(callee, "fdescribe")
  ) {
    return true
  }
  return false
}

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
        if (
          /^\s*(\/\/|\/\*)\s*(oxlint-disable|eslint-disable)[^\n]*(effecttsgo\/|harness\/)/m.test(text) ||
          /oxlint-disable[^\n]*effecttsgo\//.test(text) ||
          /^\s*(\/\/|\/\*)\s*@effect-diagnostics(-next-line)?\b/m.test(text)
        ) {
          context.report({ node, message: effectTsgoDisableMessage })
        }
        if (/^\s*(\/\/|\/\*)\s*@ts-(ignore|expect-error|nocheck)\b/m.test(text)) {
          context.report({ node, message: tsSuppressionMessage })
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
        const filename = (context.filename ?? (typeof context.getFilename === "function" ? context.getFilename() : "")).replace(/\\/g, "/")
        if (/libs\/[^/]+\/domain\/src\//.test(filename) && isIdentifier(node.callee, "Date")) {
          context.report({ node, message: impureDomainGlobalMessage })
        }
      },
      MemberExpression(node) {
        const filename = (context.filename ?? (typeof context.getFilename === "function" ? context.getFilename() : "")).replace(/\\/g, "/")
        if (
          /libs\/[^/]+\/domain\/src\//.test(filename) &&
          node.computed !== true &&
          isIdentifier(node.object, "Effect") &&
          isIdentifier(node.property, "ignore")
        ) {
          context.report({ node, message: domainEffectIgnoreMessage })
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
        if (isSecretConfigCall(node)) {
          context.report({ node, message: secretConfigMessage })
        }
        if (isSqlInterpolationCall(node)) {
          context.report({ node, message: sqlInterpolationMessage })
        }
        if (isEffectRetryCall(node) && node.arguments.some(hasScheduleForever)) {
          context.report({ node, message: foreverRetryMessage })
        }
        const filename = (context.filename ?? (typeof context.getFilename === "function" ? context.getFilename() : "")).replace(/\\/g, "/")
        if (filename.includes("sample-web/src/") && isFetchCall(node)) {
          context.report({ node, message: fetchBanMessage })
        }
        if (/libs\/[^/]+\/domain\/src\//.test(filename)) {
          const callee = node.callee
          if (
            callee != null &&
            callee.type === "MemberExpression" &&
            callee.computed !== true &&
            ((isIdentifier(callee.object, "Date") && isIdentifier(callee.property, "now")) ||
             (isIdentifier(callee.object, "Math") && isIdentifier(callee.property, "random")))
          ) {
            context.report({ node, message: impureDomainGlobalMessage })
          }
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

const testIntegrity = {
  create(context) {
    return {
      Program(node) {
        const text =
          context.sourceCode && typeof context.sourceCode.text === "string"
            ? context.sourceCode.text
            : ""
        if (
          /^\s*(\/\/|\/\*)\s*(oxlint-disable|eslint-disable)[^\n]*(harness\/test-integrity|effecttsgo\/)/m.test(text) ||
          /^\s*(\/\/|\/\*)\s*@effect-diagnostics(-next-line)?\b/m.test(text)
        ) {
          context.report({ node, message: effectTsgoDisableMessage })
        }
        if (/^\s*(\/\/|\/\*)\s*@ts-(ignore|nocheck)\b/m.test(text)) {
          context.report({ node, message: testTsIgnoreMessage })
        }
      },
      CallExpression(node) {
        if (isSkippedOrFocusedTestCall(node)) {
          context.report({ node, message: testSkipOrOnlyMessage })
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
    "test-integrity": testIntegrity,
  },
}
