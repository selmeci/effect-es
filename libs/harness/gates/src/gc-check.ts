import { Effect, Option } from "effect"
import * as Graph from "effect/Graph"
import type { HarnessGraph } from "@harness/graph"

export type GcFindingKind =
  | "unused-service"
  | "unprovided-service"
  | "dead-tagged-error"
  | "orphan-effect-fn"
  | "missing-pattern-doc"
  | "untested-effect-fn"

export interface GcFinding {
  readonly kind: GcFindingKind
  readonly nodeId: string
  readonly message: string
}

export interface GcReport {
  readonly clean: boolean
  readonly findings: ReadonlyArray<GcFinding>
}

export interface GraphEntropyInput {
  readonly graph: HarnessGraph
  readonly expectedPatterns?: ReadonlyArray<string> | undefined
  readonly checkUntestedDomainFns?: boolean | undefined
}

const IGNORED_SERVICES = new Set([
  "DecisionModel",
  "DecisionModel.DecisionModel",
  "OmnigraphSync",
  "SpanRecorder",
  "@harness/ingest/SpanRecorder",
  "SampleApiClient",
  "ActiveCounterStore"
])

const IGNORED_ERRORS = new Set([
  "OmnigraphLoadError",
  "SchemaError"
])

const IGNORED_UNTESTED_FNS = new Set([
  "Friction.decide",
  "GraphGc.decide",
  "MigrationSafety.decide",
  "SessionHandoff.decide",
  "SpanBudget.decide",
  "Harness.decideGuardCommand",
  "Harness.routeStep",
  "Harness.proposeLearningAction",
  "Harness.checkPlanStepCoverage",
  "Harness.triageFailure"
])

export const decideGraphEntropy = Effect.fn("GraphGc.decide")(function* (
  input: GraphEntropyInput
) {
  yield* Effect.void

  const g = input.graph.graph
  const findings: Array<GcFinding> = []

  const incomingRequires = new Map<Graph.NodeIndex, number>()
  const incomingLayerRequires = new Map<Graph.NodeIndex, number>()
  const incomingProvides = new Map<Graph.NodeIndex, number>()
  const incomingFailsWith = new Map<Graph.NodeIndex, number>()
  const incomingTestOrCall = new Map<Graph.NodeIndex, number>()

  for (const [, edge] of Graph.edges(g)) {
    if (edge.data._tag === "RequiresService") {
      incomingRequires.set(edge.target, (incomingRequires.get(edge.target) ?? 0) + 1)
    } else if (edge.data._tag === "LayerRequires") {
      incomingLayerRequires.set(edge.target, (incomingLayerRequires.get(edge.target) ?? 0) + 1)
    } else if (edge.data._tag === "ProvidesService") {
      const srcNode = Graph.getNode(g, edge.source)
      if (Option.isSome(srcNode) && srcNode.value._tag === "ServiceLayer") {
        incomingProvides.set(edge.target, (incomingProvides.get(edge.target) ?? 0) + 1)
      }
    } else if (edge.data._tag === "FailsWith") {
      incomingFailsWith.set(edge.target, (incomingFailsWith.get(edge.target) ?? 0) + 1)
    } else if (edge.data._tag === "ExercisesSpan" || edge.data._tag === "TracedCall") {
      incomingTestOrCall.set(edge.target, (incomingTestOrCall.get(edge.target) ?? 0) + 1)
    }
  }

  let hasVitestCases = false
  for (const [, node] of Graph.nodes(g)) {
    if (node._tag === "VitestCase") {
      hasVitestCases = true
      break
    }
  }

  // 1. unused-service
  for (const [idx, node] of Graph.nodes(g)) {
    if (node._tag === "ServiceTag") {
      if (IGNORED_SERVICES.has(node.tagId) || IGNORED_SERVICES.has(node.name)) {
        continue
      }
      const totalConsumers =
        (incomingRequires.get(idx) ?? 0) + (incomingLayerRequires.get(idx) ?? 0)
      if (totalConsumers === 0) {
        findings.push({
          kind: "unused-service",
          nodeId: node.tagId,
          message: `ServiceTag "${node.tagId}" has no consumers (0 RequiresService / LayerRequires edges).`
        })
      }
    }
  }

  // 2. unprovided-service
  for (const [idx, node] of Graph.nodes(g)) {
    if (node._tag === "ServiceTag") {
      if (IGNORED_SERVICES.has(node.tagId) || IGNORED_SERVICES.has(node.name)) {
        continue
      }
      const providers = incomingProvides.get(idx) ?? 0
      if (providers === 0) {
        findings.push({
          kind: "unprovided-service",
          nodeId: node.tagId,
          message: `ServiceTag "${node.tagId}" has no providing ServiceLayer (0 ProvidesService edges).`
        })
      }
    }
  }

  // 3. dead-tagged-error
  for (const [idx, node] of Graph.nodes(g)) {
    if (node._tag === "TaggedError") {
      if (IGNORED_ERRORS.has(node.errorTag)) {
        continue
      }
      const failsWithCount = incomingFailsWith.get(idx) ?? 0
      if (failsWithCount === 0) {
        findings.push({
          kind: "dead-tagged-error",
          nodeId: node.errorTag,
          message: `TaggedError "${node.errorTag}" is never emitted in any E channel (0 FailsWith edges).`
        })
      }
    }
  }

  // 4. missing-pattern-doc
  if (input.expectedPatterns !== undefined) {
    const existingPatternSlugs = new Set<string>()
    for (const [, node] of Graph.nodes(g)) {
      if (node._tag === "PatternDoc") {
        existingPatternSlugs.add(node.slug)
        if ("patternName" in node && typeof (node as any).patternName === "string") {
          existingPatternSlugs.add((node as any).patternName)
        }
        if (typeof node.path === "string" && node.path.endsWith(".md")) {
          const base = node.path.split("/").pop()?.replace(/\.md$/, "")
          if (base) {
            existingPatternSlugs.add(base)
          }
        }
      }
    }

    for (const p of input.expectedPatterns) {
      if (p === "review" || p === "effect") {
        continue
      }
      if (!existingPatternSlugs.has(p)) {
        findings.push({
          kind: "missing-pattern-doc",
          nodeId: `Pattern:${p}`,
          message: `Pattern doc "agent-patterns/${p}.md" registered in IdiomRouterV1 is missing from the graph.`
        })
      }
    }
  }

  // 5. untested-effect-fn
  if (input.checkUntestedDomainFns === true || hasVitestCases) {
    for (const [idx, node] of Graph.nodes(g)) {
      if (
        node._tag === "EffectFn" &&
        node.packageTag === "domain" &&
        !node.isStub &&
        !IGNORED_UNTESTED_FNS.has(node.spanName)
      ) {
        if ((incomingTestOrCall.get(idx) ?? 0) === 0) {
          findings.push({
            kind: "untested-effect-fn",
            nodeId: node.spanName,
            message: `Domain EffectFn "${node.spanName}" (${node.qualname}) has 0 reaching tests (0 ExercisesSpan / TracedCall edges).`
          })
        }
      }
    }
  }

  return {
    clean: findings.length === 0,
    findings
  } satisfies GcReport
})

export const scanGraphEntropy = (
  graph: HarnessGraph,
  options?: {
    readonly expectedPatterns?: ReadonlyArray<string> | undefined
    readonly checkUntestedDomainFns?: boolean | undefined
  }
): GcReport =>
  Effect.runSync(
    decideGraphEntropy({
      graph,
      expectedPatterns: options?.expectedPatterns,
      checkUntestedDomainFns: options?.checkUntestedDomainFns
    })
  )
