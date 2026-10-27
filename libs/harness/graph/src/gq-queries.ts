import { Option } from "effect"
import * as Graph from "effect/Graph"
import {
  type ArchiMateLayer,
  classifyOntologyNode,
  projectOntologyLayers,
  queryOntologyWhy
} from "./archimate-ontology.js"
import {
  findCallees,
  findCallers,
  findTestsReaching,
  resolveNode
} from "./graph-engine.js"
import type { HarnessGraph } from "./model.js"

export const HARNESS_GQ_QUERY_NAMES = [
  "resolve_effect_fn",
  "find_service_providers",
  "find_callers",
  "find_callees",
  "find_tests_reaching",
  "ontology_layer_nodes",
  "ontology_governed_by",
  "untested_domain_fns"
] as const

export type HarnessGqQueryName = (typeof HARNESS_GQ_QUERY_NAMES)[number]

export interface HarnessGqQueryDescriptor {
  readonly name: HarnessGqQueryName
  readonly description: string
  readonly params: ReadonlyArray<string>
  readonly source: string
}

export const HARNESS_GQ_QUERIES: Readonly<
  Record<HarnessGqQueryName, HarnessGqQueryDescriptor>
> = {
  resolve_effect_fn: {
    name: "resolve_effect_fn",
    description:
      "Resolve an Effect function or symbol and return its properties and ArchiMate classification",
    params: ["spanOrQualname"],
    source: `query resolve_effect_fn($spanOrQualname: String) {
  match {
    $fn: EffectFn
  }
  where $fn.spanName = $spanOrQualname or $fn.qualname = $spanOrQualname
  return {
    $fn.qualname,
    $fn.spanName,
    $fn.packageTag,
    $fn.file,
    $fn.line,
    $fn.successType,
    $fn.isStub,
    $fn.archimateLayer,
    $fn.archimateAspect,
    $fn.archimateElementType
  }
}`
  },
  find_service_providers: {
    name: "find_service_providers",
    description:
      "Find all ServiceLayer implementations that provide a given ServiceTag",
    params: ["tagId"],
    source: `query find_service_providers($tagId: String) {
  match {
    $layer: ServiceLayer -[:ProvidesService]-> $tag: ServiceTag
  }
  where $tag.tagId = $tagId or $tag.name = $tagId
  return {
    layerQualname: $layer.qualname,
    layerKind: $layer.layerKind,
    packageTag: $layer.packageTag,
    file: $layer.file,
    tagId: $tag.tagId
  }
}`
  },
  find_callers: {
    name: "find_callers",
    description: "Find callers of an Effect function, service, or layer",
    params: ["target"],
    source: `query find_callers($target: String) {
  match {
    $caller -[$rel]-> $callee
  }
  where $callee.qualname = $target or $callee.spanName = $target or $callee.tagId = $target or $callee.name = $target or $callee.errorTag = $target
  return {
    caller: $caller,
    rel: $rel,
    callee: $callee
  }
}`
  },
  find_callees: {
    name: "find_callees",
    description: "Find callees of an Effect function, service, or layer",
    params: ["caller"],
    source: `query find_callees($caller: String) {
  match {
    $src -[$rel]-> $callee
  }
  where $src.qualname = $caller or $src.spanName = $caller or $src.id = $caller or $src.testId = $caller
  return {
    src: $src,
    rel: $rel,
    callee: $callee
  }
}`
  },
  find_tests_reaching: {
    name: "find_tests_reaching",
    description: "Find test cases reaching a given callee Effect function",
    params: ["callee"],
    source: `query find_tests_reaching($callee: String) {
  match {
    $test: VitestCase -[:ExercisesSpan*1..10]-> $fn: EffectFn
  }
  where $fn.qualname = $callee or $fn.spanName = $callee
  return {
    testId: $test.testId,
    testFile: $test.testFile,
    testName: $test.testName
  }
}`
  },
  ontology_layer_nodes: {
    name: "ontology_layer_nodes",
    description: "Query all nodes projected onto a given ArchiMate layer",
    params: ["layer"],
    source: `query ontology_layer_nodes($layer: String) {
  match {
    $node
  }
  where $node.archimateLayer = $layer
  return {
    node: $node
  }
}`
  },
  ontology_governed_by: {
    name: "ontology_governed_by",
    description: "Query governing ADRs and realizing EARS specs for a symbol",
    params: ["symbol"],
    source: `query ontology_governed_by($symbol: String) {
  match {
    $doc -[$rel:GovernsSymbol | :SpecifiesSymbol]-> $target
  }
  where $target.qualname = $symbol or $target.tagId = $symbol or $target.errorTag = $symbol or $target.spanName = $symbol or $target.name = $symbol
  return {
    doc: $doc,
    rel: $rel,
    target: $target
  }
}`
  },
  untested_domain_fns: {
    name: "untested_domain_fns",
    description:
      "Find all non-stub domain Effect functions that lack reaching test coverage",
    params: [],
    source: `query untested_domain_fns() {
  match {
    $fn: EffectFn
  }
  where $fn.packageTag = "domain" and not $fn.isStub and not exists {
    $test: VitestCase -[:ExercisesSpan*1..10]-> $fn
  }
  return {
    qualname: $fn.qualname,
    spanName: $fn.spanName,
    file: $fn.file
  }
}`
  }
}

const getStringParam = (
  params: Readonly<Record<string, unknown>> | undefined,
  key: string,
  defaultValue = ""
): string => {
  const val = params?.[key]
  if (typeof val === "string") return val
  if (typeof val === "number" || typeof val === "boolean") return `${val}`
  return defaultValue
}

export const executeNamedGqQueryInMemory = (
  harnessGraph: HarnessGraph,
  queryName: HarnessGqQueryName,
  params?: Readonly<Record<string, unknown>>
): ReadonlyArray<Record<string, unknown>> => {
  switch (queryName) {
    case "resolve_effect_fn": {
      const spanOrQualname = getStringParam(params, "spanOrQualname")
      const node = resolveNode(harnessGraph, spanOrQualname)
      if (node) {
        const ont = classifyOntologyNode(node)
        return [
          {
            ...node,
            ...ont,
            archimateLayer: ont.layer,
            archimateAspect: ont.aspect,
            archimateElementType: ont.elementType
          }
        ]
      }
      return []
    }
    case "find_service_providers": {
      const tagIdParam = getStringParam(params, "tagId")
      const results: Array<Record<string, unknown>> = []
      const g = harnessGraph.graph
      for (const [, edge] of Graph.edges(g)) {
        if (edge.data._tag === "ProvidesService") {
          const dstNodeOpt = Graph.getNode(g, edge.target)
          const srcNodeOpt = Graph.getNode(g, edge.source)
          if (Option.isSome(dstNodeOpt) && Option.isSome(srcNodeOpt)) {
            const tagNode = dstNodeOpt.value
            const layerNode = srcNodeOpt.value
            if (
              tagNode._tag === "ServiceTag" &&
              layerNode._tag === "ServiceLayer" &&
              (tagNode.tagId === tagIdParam || tagNode.name === tagIdParam)
            ) {
              results.push({
                layerQualname: layerNode.qualname,
                layerKind: layerNode.layerKind,
                packageTag: layerNode.packageTag,
                file: layerNode.file,
                tagId: tagNode.tagId
              })
            }
          }
        }
      }
      return results
    }
    case "find_callers": {
      const target = getStringParam(params, "target")
      return findCallers(harnessGraph, target).map((c) => ({ ...c }))
    }
    case "find_callees": {
      const caller = getStringParam(params, "caller")
      return findCallees(harnessGraph, caller).map((c) => ({ ...c }))
    }
    case "find_tests_reaching": {
      const callee = getStringParam(params, "callee")
      return findTestsReaching(harnessGraph, callee).map((t) => ({ ...t }))
    }
    case "ontology_layer_nodes": {
      const layer = getStringParam(
        params,
        "layer",
        "Business"
      ) as ArchiMateLayer
      const projection = projectOntologyLayers(harnessGraph)
      if (layer in projection.layers) {
        return projection.layers[layer].map((node) => ({ ...node }))
      }
      return []
    }
    case "ontology_governed_by": {
      const symbol = getStringParam(params, "symbol")
      const why = queryOntologyWhy(harnessGraph, symbol)
      return [
        ...why.governingAdrs.map((a) => ({ docKind: "AdrDoc" as const, ...a })),
        ...why.realizingSpecs.map((s) => ({ docKind: "EarsSpec" as const, ...s }))
      ]
    }
    case "untested_domain_fns": {
      const results: Array<Record<string, unknown>> = []
      const g = harnessGraph.graph
      for (const [, node] of Graph.nodes(g)) {
        if (
          node._tag === "EffectFn" &&
          node.packageTag === "domain" &&
          !node.isStub
        ) {
          const reaching = findTestsReaching(harnessGraph, node.qualname)
          if (reaching.length === 0) {
            results.push({
              qualname: node.qualname,
              spanName: node.spanName,
              file: node.file
            })
          }
        }
      }
      return results
    }
  }
}
