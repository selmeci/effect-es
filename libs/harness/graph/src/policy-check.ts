import { Option } from "effect"
import * as Graph from "effect/Graph"
import { renderMermaid } from "./graph-engine.js"
import {
  type EffectFnNode,
  getNodeKey,
  type HarnessGraph,
  type HarnessNode,
  type ServiceTagNode
} from "./model.js"

export interface GraphPolicyViolation {
  readonly rule:
    | "domain-requires-infra"
    | "domain-requires-cloud-binding"
    | "layer-cycle"
    | "impure-decider"
  readonly message: string
  readonly path: ReadonlyArray<string>
}

export interface CheckEffectGraphResult {
  readonly ok: boolean
  readonly violations: ReadonlyArray<GraphPolicyViolation>
  readonly mermaid: string
}

const isCloudBinding = (node: ServiceTagNode): boolean =>
  /^(Cloudflare|Alchemy|Drizzle|Provider|Binding)\b/.test(node.tagId) ||
  /^(Cloudflare|Alchemy|Drizzle|Provider|Binding)\b/.test(node.name)

const isDeciderSpan = (spanName: string): boolean =>
  spanName.endsWith(".decide") || spanName === "decide"

export const checkEffectGraph = (harnessGraph: HarnessGraph): CheckEffectGraphResult => {
  const violations: Array<GraphPolicyViolation> = []

  const domainFns: Array<{ readonly index: Graph.NodeIndex; readonly node: EffectFnNode }> = []
  const forbiddenServices: Array<{
    readonly index: Graph.NodeIndex
    readonly node: ServiceTagNode
    readonly rule: "domain-requires-infra" | "domain-requires-cloud-binding"
  }> = []

  // 1. Collect domain functions and forbidden services
  for (const [idx, node] of Graph.nodes(harnessGraph.graph)) {
    if (node._tag === "EffectFn" && node.packageTag === "domain") {
      domainFns.push({ index: idx, node })
    } else if (node._tag === "ServiceTag") {
      if (node.packageTag === "infra") {
        forbiddenServices.push({
          index: idx,
          node,
          rule: "domain-requires-infra"
        })
      } else if (isCloudBinding(node)) {
        forbiddenServices.push({
          index: idx,
          node,
          rule: "domain-requires-cloud-binding"
        })
      }
    }
  }

  // Rule 1: domain-requires-infra & domain-requires-cloud-binding via Graph.simplePaths
  for (const domainFn of domainFns) {
    for (const forbiddenSvc of forbiddenServices) {
      const walker = Graph.simplePaths(harnessGraph.graph, {
        source: domainFn.index,
        target: forbiddenSvc.index,
        limit: 1
      })
      for (const pathResult of walker) {
        const pathKeys = pathResult.path.map((nodeIdx) => {
          const nodeOpt = Graph.getNode(harnessGraph.graph, nodeIdx)
          return Option.isSome(nodeOpt) ? getNodeKey(nodeOpt.value) : String(nodeIdx)
        })
        const message =
          forbiddenSvc.rule === "domain-requires-infra"
            ? `Domain function '${domainFn.node.qualname}' forbidden dependency on infra service '${forbiddenSvc.node.tagId}'`
            : `Domain function '${domainFn.node.qualname}' forbidden dependency on cloud binding '${forbiddenSvc.node.tagId}'`
        violations.push({
          rule: forbiddenSvc.rule,
          message,
          path: pathKeys
        })
      }
    }
  }

  // Rule 2: impure-decider (deciders in type:domain cannot require any services)
  for (const domainFn of domainFns) {
    if (isDeciderSpan(domainFn.node.spanName)) {
      for (const [, edge] of Graph.edges(harnessGraph.graph)) {
        if (edge.source === domainFn.index && edge.data._tag === "RequiresService") {
          violations.push({
            rule: "impure-decider",
            message: `Decider function '${domainFn.node.qualname}' (${domainFn.node.spanName}) must be pure and cannot require service '${edge.data.tagId}'`,
            path: [domainFn.node.qualname, edge.data.tagId]
          })
        }
      }
    }
  }

  // Rule 3: layer-cycle via Graph.findCycle on projected dependency graph
  const nodeMap = new Map<Graph.NodeIndex, Graph.NodeIndex>()
  const depGraph = Graph.directed<HarnessNode, string>((mutable) => {
    for (const [origIdx, node] of Graph.nodes(harnessGraph.graph)) {
      if (node._tag === "ServiceLayer" || node._tag === "ServiceTag") {
        const newIdx = Graph.addNode(mutable, node)
        nodeMap.set(origIdx, newIdx)
      }
    }

    for (const [, edge] of Graph.edges(harnessGraph.graph)) {
      if (edge.data._tag === "LayerRequires") {
        const src = nodeMap.get(edge.source)
        const dst = nodeMap.get(edge.target)
        if (src !== undefined && dst !== undefined) {
          Graph.addEdge(mutable, src, dst, "LayerRequires")
        }
      } else if (edge.data._tag === "ProvidesService") {
        // In harnessGraph, edge is Layer -> ServiceTag.
        // In dependency projection, ServiceTag is provided by Layer, so ServiceTag -> Layer.
        const src = nodeMap.get(edge.target)
        const dst = nodeMap.get(edge.source)
        if (src !== undefined && dst !== undefined) {
          Graph.addEdge(mutable, src, dst, "ProvidesService")
        }
      }
    }
  })

  const cycleOpt = Graph.findCycle(depGraph)
  if (Option.isSome(cycleOpt)) {
    const cycle = cycleOpt.value
    const path = cycle.path.map((idx) => {
      const nodeOpt = Graph.getNode(depGraph, idx)
      return Option.isSome(nodeOpt) ? getNodeKey(nodeOpt.value) : String(idx)
    })
    violations.push({
      rule: "layer-cycle",
      message: `Layer dependency cycle detected: ${path.join(" -> ")}`,
      path
    })
  }

  const mermaid = renderMermaid(harnessGraph)

  return {
    ok: violations.length === 0,
    violations,
    mermaid
  }
}
