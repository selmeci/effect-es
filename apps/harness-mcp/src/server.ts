import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { Effect, Layer, Option, Schema } from "effect"
import * as DecisionModel from "effect/ai/DecisionModel"
import {
  buildHarnessGraph,
  findCallees,
  findCallers,
  findTestsReaching,
  HARNESS_GQ_QUERY_NAMES,
  type HarnessGqQueryName,
  type HarnessGraph,
  invokeOmnigraphNamedQuery,
  loadGraphSnapshot,
  OmnigraphSync,
  projectOntologyLayers,
  queryOntologyImpact,
  queryOntologyWhy,
  resolveNode,
  structuralSearch
} from "@harness/graph"
import {
  decideOntologyInvariants,
  evaluateOntologyConflicts,
  extractOntologyConflictPairs,
  type GovernanceDocReference,
  loadGovernanceDocsFromDisk,
  LocalDecisionModel,
  routeStep
} from "@harness/decision"

export class UnknownToolError extends Schema.TaggedError<UnknownToolError>()(
  "UnknownToolError",
  {
    toolName: Schema.String
  }
) {}

export interface ServerOptions {
  readonly graph?: HarnessGraph
  readonly snapshotPath?: string
  readonly decisionLayer?: Layer.Layer<DecisionModel.DecisionModel>
  readonly repoRoot?: string
  readonly governanceDocs?: ReadonlyArray<GovernanceDocReference>
}

const findRepoRoot = (startDir: string): string => {
  let curr = path.resolve(startDir)
  while (curr !== path.dirname(curr)) {
    if (fs.existsSync(path.join(curr, "pnpm-workspace.yaml"))) {
      return curr
    }
    curr = path.dirname(curr)
  }
  return startDir
}

const resolveGraph = (options?: ServerOptions): Effect.Effect<HarnessGraph> => {
  if (options?.graph) {
    return Effect.succeed(options.graph)
  }
  return Effect.try(() => {
    const root = findRepoRoot(process.cwd())
    const snapshotPath =
      options?.snapshotPath ??
      path.join(root, ".harness", "graph-snapshot.json")
    if (fs.existsSync(snapshotPath)) {
      return loadGraphSnapshot(snapshotPath)
    }
    return buildHarnessGraph({
      fns: [],
      services: [],
      layers: [],
      errors: [],
      tests: [],
      patternDocs: []
    })
  }).pipe(
    Effect.orElseSucceed(() =>
      buildHarnessGraph({
        fns: [],
        services: [],
        layers: [],
        errors: [],
        tests: [],
        patternDocs: []
      })
    )
  )
}

export const executeToolEffect = (
  toolName: string,
  args: Record<string, unknown>,
  options?: ServerOptions
): Effect.Effect<unknown, UnknownToolError> =>
  Effect.gen(function* () {
    switch (toolName) {
      case "harness_resolve": {
        const symbolOrSpan = (args as { symbolOrSpan: string }).symbolOrSpan
        const graph = yield* resolveGraph(options)
        return resolveNode(graph, symbolOrSpan) ?? null
      }
      case "harness_callers": {
        const symbolOrSpan = (args as { symbolOrSpan: string }).symbolOrSpan
        const graph = yield* resolveGraph(options)
        return findCallers(graph, symbolOrSpan)
      }
      case "harness_callees": {
        const symbolOrSpan = (args as { symbolOrSpan: string }).symbolOrSpan
        const graph = yield* resolveGraph(options)
        return findCallees(graph, symbolOrSpan)
      }
      case "harness_tests_reaching": {
        const symbolOrSpan = (args as { symbolOrSpan: string }).symbolOrSpan
        const graph = yield* resolveGraph(options)
        return findTestsReaching(graph, symbolOrSpan)
      }
      case "harness_structural_search": {
        const pattern = (args as { pattern: string }).pattern
        return structuralSearch({ pattern })
      }
      case "harness_route": {
        const planStep = (args as { planStep: string }).planStep
        const decisionLayer = options?.decisionLayer ?? LocalDecisionModel
        const routedOpt = yield* routeStep(planStep).pipe(
          Effect.provide(decisionLayer),
          Effect.timeoutOption("1500 millis"),
          Effect.catchCause(() => Effect.succeedNone)
        )
        const block = Option.getOrElse(routedOpt, () => "review")
        const patternFile =
          block === "review" || block === "effect"
            ? null
            : `agent-patterns/${block}.md`
        return { block, patternFile }
      }
      case "harness_ontology_why": {
        const symbolOrSpan = (args as { symbolOrSpan: string }).symbolOrSpan
        const graph = yield* resolveGraph(options)
        return queryOntologyWhy(graph, symbolOrSpan)
      }
      case "harness_ontology_impact": {
        const symbolOrSpan = (args as { symbolOrSpan: string }).symbolOrSpan
        const graph = yield* resolveGraph(options)
        return queryOntologyImpact(graph, symbolOrSpan)
      }
      case "harness_ontology_check": {
        const scope = (args as { scope?: string | undefined }).scope
        const graph = yield* resolveGraph(options)
        const root = options?.repoRoot ?? findRepoRoot(process.cwd())
        const docs = options?.governanceDocs ?? loadGovernanceDocsFromDisk(root)
        const invariants = yield* decideOntologyInvariants({
          graph,
          governanceDocs: docs
        })
        const pairs = extractOntologyConflictPairs(docs, scope)
        const decisionLayer = options?.decisionLayer ?? LocalDecisionModel
        const semanticConflicts = yield* evaluateOntologyConflicts(pairs).pipe(
          Effect.provide(decisionLayer)
        )
        const projection = projectOntologyLayers(graph)
        return {
          clean: invariants.clean && semanticConflicts.length === 0,
          findings: invariants.findings,
          semanticConflicts,
          evaluatedPairs: pairs.length,
          layerCounts: {
            Motivation: projection.layers.Motivation.length,
            Business: projection.layers.Business.length,
            Application: projection.layers.Application.length,
            Technology: projection.layers.Technology.length,
            Implementation: projection.layers.Implementation.length
          }
        }
      }
      case "harness_gq_query": {
        const queryName = (args as { queryName: HarnessGqQueryName }).queryName
        const params = (args as { params?: Record<string, unknown> | undefined }).params
        const branch = (args as { branch?: string | undefined }).branch
        const graph = yield* resolveGraph(options)
        return yield* invokeOmnigraphNamedQuery({
          name: queryName,
          params,
          branch,
          fallbackGraph: graph
        }).pipe(Effect.provide(OmnigraphSync.Live))
      }
      default: {
        return yield* new UnknownToolError({ toolName })
      }
    }
  })

export const executeTool = (
  toolName: string,
  args: Record<string, unknown>,
  options?: ServerOptions
): Promise<unknown> => Effect.runPromise(executeToolEffect(toolName, args, options))

export const createServer = (options?: ServerOptions): McpServer => {
  const server = new McpServer({ name: "harness-mcp", version: "0.0.0" })

  server.tool(
    "harness_resolve",
    "Resolve a symbol or span name to its node in the Effect graph",
    { symbolOrSpan: z.string().describe("Symbol or span name to resolve") },
    (args) =>
      Effect.runPromise(
        executeToolEffect("harness_resolve", args, options).pipe(
          Effect.map((data) => ({
            content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }]
          }))
        )
      )
  )

  server.tool(
    "harness_callers",
    "Find callers of an Effect function, service, or layer",
    { symbolOrSpan: z.string().describe("Symbol or span name to query callers for") },
    (args) =>
      Effect.runPromise(
        executeToolEffect("harness_callers", args, options).pipe(
          Effect.map((data) => ({
            content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }]
          }))
        )
      )
  )

  server.tool(
    "harness_callees",
    "Find callees of an Effect function, service, or layer",
    { symbolOrSpan: z.string().describe("Symbol or span name to query callees for") },
    (args) =>
      Effect.runPromise(
        executeToolEffect("harness_callees", args, options).pipe(
          Effect.map((data) => ({
            content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }]
          }))
        )
      )
  )

  server.tool(
    "harness_tests_reaching",
    "Find all Vitest test cases reaching a given symbol or span",
    { symbolOrSpan: z.string().describe("Symbol or span name to find reaching tests for") },
    (args) =>
      Effect.runPromise(
        executeToolEffect("harness_tests_reaching", args, options).pipe(
          Effect.map((data) => ({
            content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }]
          }))
        )
      )
  )

  server.tool(
    "harness_structural_search",
    "Perform structural AST search using ast-grep across workspace TypeScript code",
    { pattern: z.string().describe("ast-grep pattern to search for across workspace TypeScript files") },
    (args) =>
      Effect.runPromise(
        executeToolEffect("harness_structural_search", args, options).pipe(
          Effect.map((data) => ({
            content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }]
          }))
        )
      )
  )

  server.tool(
    "harness_route",
    "Route an implementation plan step to an Effect idiom building block using local decision model",
    { planStep: z.string().describe("Implementation plan step text to route to an Effect idiom block") },
    (args) =>
      Effect.runPromise(
        executeToolEffect("harness_route", args, options).pipe(
          Effect.map((data) => ({
            content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }]
          }))
        )
      )
  )

  server.tool(
    "harness_ontology_why",
    "Trace upward from any symbol, service, layer, error, or span to Motivation (EARS & ADR)",
    {
      symbolOrSpan: z
        .string()
        .describe(
          "Symbol, service, layer, error, or span name to trace upward to Motivation (EARS & ADR)"
        )
    },
    (args) =>
      Effect.runPromise(
        executeToolEffect("harness_ontology_why", args, options).pipe(
          Effect.map((data) => ({
            content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }]
          }))
        )
      )
  )

  server.tool(
    "harness_ontology_impact",
    "Analyze cross-layer ArchiMate impact for a symbol, service, layer, error, or span",
    {
      symbolOrSpan: z
        .string()
        .describe(
          "Symbol, service, layer, error, or span name to analyze cross-layer ArchiMate impact for"
        )
    },
    (args) =>
      Effect.runPromise(
        executeToolEffect("harness_ontology_impact", args, options).pipe(
          Effect.map((data) => ({
            content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }]
          }))
        )
      )
  )

  server.tool(
    "harness_ontology_check",
    "Check deterministic cross-layer ArchiMate invariants and Clef semantic conflicts across governance docs and graph",
    {
      scope: z
        .string()
        .optional()
        .describe(
          "Optional scope name (e.g. 'sample') to check deterministic cross-layer invariants and Clef semantic conflicts"
        )
    },
    (args) =>
      Effect.runPromise(
        executeToolEffect("harness_ontology_check", args, options).pipe(
          Effect.map((data) => ({
            content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }]
          }))
        )
      )
  )

  server.tool(
    "harness_gq_query",
    "Execute a canonical Omnigraph .gq query (against live Omnigraph v0.14.0 or deterministic in-memory fallback)",
    {
      queryName: z
        .enum(HARNESS_GQ_QUERY_NAMES)
        .describe(
          "Name of the canonical .gq query in libs/harness/graph/queries/harness.gq"
        ),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Query parameters matching $var placeholders"),
      branch: z
        .string()
        .optional()
        .describe("Target graph branch (defaults to 'main')")
    },
    (args) =>
      Effect.runPromise(
        executeToolEffect("harness_gq_query", args, options).pipe(
          Effect.map((data) => ({
            content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }]
          }))
        )
      )
  )

  return server
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const server = createServer()
  const transport = new StdioServerTransport()
  void Effect.runPromise(Effect.tryPromise(() => server.connect(transport)))
}
