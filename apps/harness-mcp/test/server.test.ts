import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { Effect, Layer } from "effect"
import * as DecisionModel from "effect/ai/DecisionModel"
import * as AiError from "effect/ai/AiError"
import { buildHarnessGraph, saveGraphSnapshot } from "@harness/graph"
import { createServer, executeTool } from "../src/server.js"

describe("harness-mcp tools", () => {
  const graph = buildHarnessGraph({
    fns: [
      {
        qualname: "libs/sample/domain/src/index.ts#greet",
        spanName: "Sample.greet",
        file: "libs/sample/domain/src/index.ts",
        line: 4,
        packageTag: "domain",
        successType: "string",
        isStub: false
      },
      {
        qualname: "libs/sample/service/src/index.ts#callGreet",
        spanName: "Sample.callGreet",
        file: "libs/sample/service/src/index.ts",
        line: 10,
        packageTag: "service",
        successType: "string",
        isStub: false
      }
    ],
    services: [
      {
        tagId: "libs/sample/service/src/index.ts#Greeter",
        name: "Greeter",
        file: "libs/sample/service/src/index.ts",
        packageTag: "service"
      }
    ],
    layers: [],
    errors: [],
    tests: [
      {
        testId: "libs/sample/domain/test/index.test.ts::greets by name",
        testFile: "libs/sample/domain/test/index.test.ts",
        testName: "greets by name",
        lastTreeHash: "hash1"
      }
    ],
    patternDocs: [],
    requiresService: [
      {
        callerQualname: "libs/sample/service/src/index.ts#callGreet",
        tagId: "libs/sample/service/src/index.ts#Greeter"
      }
    ],
    failsWith: [],
    providesService: [],
    layerRequires: [],
    tracedCalls: [
      {
        callerQualname: "libs/sample/service/src/index.ts#callGreet",
        calleeQualname: "libs/sample/domain/src/index.ts#greet",
        callCount: 2,
        receiverLayer: null
      }
    ],
    exercisesSpans: [
      {
        testId: "libs/sample/domain/test/index.test.ts::greets by name",
        calleeQualname: "libs/sample/domain/src/index.ts#greet",
        callCount: 1,
        receiverLayer: null
      }
    ]
  })

  it("resolves EffectFn node and tests_reaching from the graph snapshot", async () => {
    expect(createServer({ graph })).toBeDefined()
    const resolved = await executeTool("harness_resolve", { symbolOrSpan: "Sample.greet" }, { graph })
    expect(resolved).toMatchObject({
      qualname: "libs/sample/domain/src/index.ts#greet",
      spanName: "Sample.greet"
    })

    const tests = await executeTool("harness_tests_reaching", { symbolOrSpan: "Sample.greet" }, { graph })
    expect(tests).toEqual([
      expect.objectContaining({
        testId: "libs/sample/domain/test/index.test.ts::greets by name"
      })
    ])
  })

  it("queries callers and callees correctly", async () => {
    const callers = await executeTool("harness_callers", { symbolOrSpan: "Sample.greet" }, { graph })
    expect(callers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          qualname: "libs/sample/service/src/index.ts#callGreet",
          edgeKind: "TracedCall"
        }),
        expect.objectContaining({
          testId: "libs/sample/domain/test/index.test.ts::greets by name",
          edgeKind: "ExercisesSpan"
        })
      ])
    )

    const callees = await executeTool(
      "harness_callees",
      { symbolOrSpan: "libs/sample/service/src/index.ts#callGreet" },
      { graph }
    )
    expect(callees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          qualname: "libs/sample/domain/src/index.ts#greet",
          edgeKind: "TracedCall"
        }),
        expect.objectContaining({
          tagId: "libs/sample/service/src/index.ts#Greeter",
          edgeKind: "RequiresService"
        })
      ])
    )
  })

  it("executes structural search across workspace files", async () => {
    const results = (await executeTool(
      "harness_structural_search",
      { pattern: "export const greet = $$$" },
      { graph }
    )) as Array<{ file: string; text: string }>

    expect(Array.isArray(results)).toBe(true)
    expect(results.some((r) => r.file.includes("libs/sample/domain/src/index.ts"))).toBe(true)
  })

  it("routes plan step with mock decisionLayer", async () => {
    const mockModel: DecisionModel.DecisionModel = {
      [DecisionModel.TypeId]: DecisionModel.TypeId,
      decide: (() =>
        Effect.succeed({
          answers: {
            fitsAny: { probability: 0.95 },
            block: { label: "services-and-layers" }
          },
          usage: new DecisionModel.DecisionUsage({ inputTokens: 5, outputTokens: 5 })
        })) as any
    }
    const decisionLayer = Layer.succeed(DecisionModel.DecisionModel, mockModel)

    const routed = await executeTool(
      "harness_route",
      { planStep: "Define a Greeter service" },
      { decisionLayer }
    )
    expect(routed).toEqual({
      block: "services-and-layers",
      patternFile: "agent-patterns/services-and-layers.md"
    })
  })

  it("routes plan step to null patternFile for effect or review", async () => {
    const effectModel: DecisionModel.DecisionModel = {
      [DecisionModel.TypeId]: DecisionModel.TypeId,
      decide: (() =>
        Effect.succeed({
          answers: {
            fitsAny: { probability: 0.95 },
            block: { label: "effect" }
          },
          usage: new DecisionModel.DecisionUsage({ inputTokens: 5, outputTokens: 5 })
        })) as any
    }
    const effectLayer = Layer.succeed(DecisionModel.DecisionModel, effectModel)

    const routedEffect = await executeTool(
      "harness_route",
      { planStep: "Simple effect calculation" },
      { decisionLayer: effectLayer }
    )
    expect(routedEffect).toEqual({
      block: "effect",
      patternFile: null
    })

    const reviewModel: DecisionModel.DecisionModel = {
      [DecisionModel.TypeId]: DecisionModel.TypeId,
      decide: (() =>
        Effect.succeed({
          answers: {
            fitsAny: { probability: 0.4 },
            block: { label: "services-and-layers" }
          },
          usage: new DecisionModel.DecisionUsage({ inputTokens: 5, outputTokens: 5 })
        })) as any
    }
    const reviewLayer = Layer.succeed(DecisionModel.DecisionModel, reviewModel)

    const routedReview = await executeTool(
      "harness_route",
      { planStep: "Ambiguous vague task" },
      { decisionLayer: reviewLayer }
    )
    expect(routedReview).toEqual({
      block: "review",
      patternFile: null
    })
  })

  it("handles offline or failing decisionLayer gracefully", async () => {
    const failingModel: DecisionModel.DecisionModel = {
      [DecisionModel.TypeId]: DecisionModel.TypeId,
      decide: (() =>
        Effect.fail(
          AiError.make({
            module: "DecisionModel",
            method: "decide",
            reason: new AiError.UnknownError({ description: "Connection refused to Ollama" })
          })
        )) as any
    }
    const failingLayer = Layer.succeed(DecisionModel.DecisionModel, failingModel)

    const routed = await executeTool(
      "harness_route",
      { planStep: "Any step" },
      { decisionLayer: failingLayer }
    )
    expect(routed).toEqual({
      block: "review",
      patternFile: null
    })
  })

  it("falls back gracefully when snapshot file does not exist (offline fallback)", async () => {
    const nonExistentPath = path.join(os.tmpdir(), `non-existent-${Date.now()}.json`)
    const resolved = await executeTool(
      "harness_resolve",
      { symbolOrSpan: "NonExistent" },
      { snapshotPath: nonExistentPath }
    )
    expect(resolved).toBeNull()

    const tests = await executeTool(
      "harness_tests_reaching",
      { symbolOrSpan: "NonExistent" },
      { snapshotPath: nonExistentPath }
    )
    expect(tests).toEqual([])
  })

  it("resolves reaching tests from disk snapshot when snapshotPath is provided", async () => {
    const tempSnapshotPath = path.join(os.tmpdir(), `test-snapshot-${Date.now()}.json`)
    try {
      saveGraphSnapshot(graph, tempSnapshotPath)
      const tests = await executeTool(
        "harness_tests_reaching",
        { symbolOrSpan: "Sample.greet" },
        { snapshotPath: tempSnapshotPath }
      )
      expect(tests).toEqual([
        expect.objectContaining({
          testId: "libs/sample/domain/test/index.test.ts::greets by name"
        })
      ])
    } finally {
      if (fs.existsSync(tempSnapshotPath)) {
        fs.unlinkSync(tempSnapshotPath)
      }
    }
  })

  it("rejects unknown tools", async () => {
    await expect(executeTool("unknown_tool", {})).rejects.toThrow()
  })

  it("completes MCP stdio handshake and lists all 12 tools when spawned from Antigravity plugin directory", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
    const repoRoot = path.resolve(import.meta.dirname, "../../..")
    const pluginDir = path.join(repoRoot, "adapters/antigravity/plugins/effect-harness")
    const mcpConfig = JSON.parse(
      fs.readFileSync(path.join(pluginDir, "mcp_config.json"), "utf8")
    ) as {
      readonly mcpServers: {
        readonly "harness-mcp": { readonly command: string; readonly args: Array<string> }
      }
    }
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: mcpConfig.mcpServers["harness-mcp"].args,
      cwd: pluginDir
    })
    const client = new Client({ name: "test-client", version: "1.0.0" })
    try {
      await client.connect(transport)
      const toolsList = await client.listTools()
      expect(toolsList.tools.map((t) => t.name)).toEqual([
        "harness_resolve",
        "harness_callers",
        "harness_callees",
        "harness_tests_reaching",
        "harness_structural_search",
        "harness_route",
        "harness_ontology_why",
        "harness_ontology_impact",
        "harness_ontology_check",
        "harness_gq_query",
        "harness_lsp_diagnostics",
        "harness_telemetry_report"
      ])
    } finally {
      await client.close()
    }
  })
})
