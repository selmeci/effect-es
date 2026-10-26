import { describe, expect, it } from "@effect/vitest"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { Effect } from "effect"
import { buildHarnessGraph, loadGraphSnapshot } from "@harness/graph"
import {
  buildSessionHandoff,
  checkSpanBudgets,
  decideGraphEntropy,
  decideSessionHandoff,
  decideSpanBudgets,
  diffPlanAndImplGraphs,
  resolveHarnessStateDir,
  scanGraphEntropy,
  type FrictionCluster,
  type SpanSample
} from "../src/index.js"

describe("Harness Gates: GC check, Session Handoff, Span Budget, and State Dir", () => {
  it("diffs plan and impl snapshots and confirms 0 missing symbols", () => {
    const repoRoot = "/home/roan/WebstormProjects/effect-ts-harness"
    const planPath = join(repoRoot, ".harness", "plan-graph-snapshot.json")
    const implPath = join(repoRoot, ".harness", "graph-snapshot.json")
    if (existsSync(planPath) && existsSync(implPath)) {
      const planGraph = loadGraphSnapshot(planPath)
      const implGraph = loadGraphSnapshot(implPath)
      const diff = diffPlanAndImplGraphs(planGraph, implGraph)
      expect(diff.ok).toBe(true)
      expect(diff.reasons).toHaveLength(0)
    }
  })
  describe("decideGraphEntropy / scanGraphEntropy", () => {
    it.effect("detects unused-service, unprovided-service, dead-tagged-error, and missing-pattern-doc", () =>
      Effect.gen(function* () {
        const graph = buildHarnessGraph({
          services: [
            {
              tagId: "UnusedAndUnprovided",
              name: "UnusedAndUnprovided",
              packageTag: "service",
              file: "libs/sample/service/src/index.ts"
            },
            // Built-in framework services should be ignored
            {
              tagId: "DecisionModel",
              name: "DecisionModel",
              packageTag: "service",
              file: "libs/harness/decision/src/index.ts"
            },
            {
              tagId: "@harness/ingest/SpanRecorder",
              name: "SpanRecorder",
              packageTag: "service",
              file: "libs/harness/ingest/src/index.ts"
            }
          ],
          errors: [
            {
              errorTag: "DeadCustomError",
              file: "libs/sample/contract/src/index.ts"
            },
            // Built-in framework errors should be ignored
            {
              errorTag: "OmnigraphLoadError",
              file: "libs/harness/graph/src/index.ts"
            },
            {
              errorTag: "SchemaError",
              file: "libs/harness/graph/src/index.ts"
            }
          ]
        })

        const report = yield* decideGraphEntropy({
          graph,
          expectedPatterns: ["planning", "httpapi", "review", "effect"]
        })

        expect(report.clean).toBe(false)

        const kinds = report.findings.map((f) => f.kind)
        expect(kinds).toContain("unused-service")
        expect(kinds).toContain("unprovided-service")
        expect(kinds).toContain("dead-tagged-error")
        expect(kinds).toContain("missing-pattern-doc")

        // Unused & unprovided for UnusedAndUnprovided
        const unused = report.findings.find(
          (f) => f.kind === "unused-service" && f.nodeId === "UnusedAndUnprovided"
        )
        expect(unused).toBeDefined()
        expect(unused?.message).toContain("has no consumers")

        const unprovided = report.findings.find(
          (f) => f.kind === "unprovided-service" && f.nodeId === "UnusedAndUnprovided"
        )
        expect(unprovided).toBeDefined()
        expect(unprovided?.message).toContain("has no providing ServiceLayer")

        // Ignored services should NOT produce findings
        expect(
          report.findings.some(
            (f) => f.nodeId === "DecisionModel" || f.nodeId === "@harness/ingest/SpanRecorder"
          )
        ).toBe(false)

        // Dead tagged error
        const deadErr = report.findings.find(
          (f) => f.kind === "dead-tagged-error" && f.nodeId === "DeadCustomError"
        )
        expect(deadErr).toBeDefined()
        expect(deadErr?.message).toContain("is never emitted in any E channel")

        // Ignored errors should NOT produce findings
        expect(
          report.findings.some(
            (f) => f.nodeId === "OmnigraphLoadError" || f.nodeId === "SchemaError"
          )
        ).toBe(false)

        // Missing pattern docs for planning and httpapi (review & effect excluded)
        const missingDocs = report.findings.filter((f) => f.kind === "missing-pattern-doc")
        expect(missingDocs.map((f) => f.nodeId)).toEqual(["Pattern:planning", "Pattern:httpapi"])
      })
    )

    it("passes clean: true via scanGraphEntropy when all elements are correctly wired", () => {
      const graph = buildHarnessGraph({
        fns: [
          {
            qualname: "libs/sample/domain/src/index.ts#greet",
            spanName: "Sample.greet",
            packageTag: "domain",
            file: "libs/sample/domain/src/index.ts",
            line: 5,
            successType: "string",
            isStub: false
          }
        ],
        services: [
          {
            tagId: "GreeterService",
            name: "GreeterService",
            packageTag: "service",
            file: "libs/sample/service/src/index.ts"
          }
        ],
        layers: [
          {
            qualname: "libs/sample/infra/src/index.ts#GreeterLive",
            layerKind: "live",
            packageTag: "infra",
            file: "libs/sample/infra/src/index.ts"
          }
        ],
        errors: [
          {
            errorTag: "GreeterError",
            file: "libs/sample/contract/src/index.ts"
          }
        ],
        patternDocs: [
          {
            slug: "planning",
            path: "agent-patterns/planning.md",
            summary: "Planning pattern"
          }
        ],
        requiresService: [
          {
            callerQualname: "libs/sample/domain/src/index.ts#greet",
            tagId: "GreeterService"
          }
        ],
        providesService: [
          {
            layerQualname: "libs/sample/infra/src/index.ts#GreeterLive",
            tagId: "GreeterService"
          }
        ],
        failsWith: [
          {
            callerQualname: "libs/sample/domain/src/index.ts#greet",
            errorTag: "GreeterError"
          }
        ]
      })

      const report = scanGraphEntropy(graph, {
        expectedPatterns: ["planning", "review", "effect"]
      })

      expect(report.clean).toBe(true)
      expect(report.findings).toHaveLength(0)
    })
  })

  describe("decideSessionHandoff / buildSessionHandoff", () => {
    it("returns handoffMessage: null when clean with no active tasks", () => {
      const summary = buildSessionHandoff({
        stampValid: true,
        activeStubs: [],
        missingPlannedFns: [],
        frictionClusters: []
      })

      expect(summary.hasActiveTask).toBe(false)
      expect(summary.stampValid).toBe(true)
      expect(summary.recentFrictionCount).toBe(0)
      expect(summary.topFrictionSummary).toHaveLength(0)
      expect(summary.handoffMessage).toBeNull()
    })

    it.effect("builds a structured handoff message when tasks or friction exist", () =>
      Effect.gen(function* () {
        const clusters: ReadonlyArray<FrictionCluster> = [
          {
            key: "verify_failure::typecheck",
            kind: "verify_failure",
            summary: "tsc error in domain",
            detail: "detail 1",
            occurrences: 3,
            lastSeen: "2026-10-26T12:00:00.000Z"
          },
          {
            key: "route_miss::d1",
            kind: "route_miss",
            summary: "missing d1 route",
            detail: "detail 2",
            occurrences: 2,
            lastSeen: "2026-10-26T12:05:00.000Z"
          }
        ]

        const summary = yield* decideSessionHandoff({
          stampValid: false,
          stampReason: "Workspace files modified",
          activeStubs: ["libs/sample/domain/src/index.ts#greet"],
          missingPlannedFns: ["libs/sample/domain/src/index.ts#cancel"],
          frictionClusters: clusters
        })

        expect(summary.hasActiveTask).toBe(true)
        expect(summary.recentFrictionCount).toBe(5)
        expect(summary.topFrictionSummary).toEqual([
          "[verify_failure x3] tsc error in domain",
          "[route_miss x2] missing d1 route"
        ])

        expect(summary.handoffMessage).not.toBeNull()
        const msg = summary.handoffMessage!
        expect(msg).toContain("[Harness Context Handoff]")
        expect(msg).toContain(
          "Active stub() skeletons remaining: libs/sample/domain/src/index.ts#greet"
        )
        expect(msg).toContain(
          "Missing planned functions from plan-graph-snapshot: libs/sample/domain/src/index.ts#cancel"
        )
        expect(msg).toContain("Verify stamp status: INVALID (Workspace files modified)")
        expect(msg).toContain(
          "Recent friction events: [verify_failure x3] tsc error in domain; [route_miss x2] missing d1 route"
        )
      })
    )
  })

  describe("decideSpanBudgets / checkSpanBudgets", () => {
    it("detects n-plus-one-call violations when child span count exceeds budget", () => {
      const parent: SpanSample = {
        spanId: "parent-1",
        name: "Order.checkout",
        parentSpanId: null
      }
      const children: Array<SpanSample> = Array.from({ length: 6 }, (_, i) => ({
        spanId: `child-${i}`,
        name: "Db.query",
        parentSpanId: "parent-1"
      }))

      const violations = checkSpanBudgets({
        spans: [parent, ...children],
        maxRepeatedChildCalls: 5
      })

      expect(violations).toHaveLength(1)
      const v = violations[0]!
      expect(v.kind).toBe("n-plus-one-call")
      expect(v.parentSpan).toBe("Order.checkout")
      expect(v.targetSpan).toBe("Db.query")
      expect(v.count).toBe(6)
      expect(v.maxAllowed).toBe(5)
      expect(v.message).toContain("N+1 span repetition detected")
    })

    it.effect("detects span-duration-exceeded violations", () =>
      Effect.gen(function* () {
        const spans: ReadonlyArray<SpanSample> = [
          {
            spanId: "s1",
            name: "SlowOperation",
            parentSpanId: null,
            durationMs: 250.7
          },
          {
            spanId: "s2",
            name: "FastOperation",
            parentSpanId: null,
            durationMs: 45.2
          }
        ]

        const violations = yield* decideSpanBudgets({
          spans,
          maxSpanDurationMs: 100
        })

        expect(violations).toHaveLength(1)
        const v = violations[0]!
        expect(v.kind).toBe("span-duration-exceeded")
        expect(v.parentSpan).toBe("root")
        expect(v.targetSpan).toBe("SlowOperation")
        expect(v.count).toBe(251)
        expect(v.maxAllowed).toBe(100)
        expect(v.message).toContain("Span duration budget exceeded")
      })
    )
  })

  describe("resolveHarnessStateDir", () => {
    it("defaults to repoRoot/.harness when env vars are unset", () => {
      expect(resolveHarnessStateDir("/repo", {})).toBe("/repo/.harness")
    })

    it("respects HARNESS_WORKTREE_ID and sanitizes special characters", () => {
      expect(
        resolveHarnessStateDir("/repo", { HARNESS_WORKTREE_ID: "feature-branch" })
      ).toBe("/repo/.harness/worktrees/feature-branch")

      expect(
        resolveHarnessStateDir("/repo", { HARNESS_WORKTREE_ID: "feat/nested#branch" })
      ).toBe("/repo/.harness/worktrees/feat_nested_branch")
    })

    it("respects HARNESS_STATE_DIR (both relative and absolute)", () => {
      expect(
        resolveHarnessStateDir("/repo", { HARNESS_STATE_DIR: ".custom-state" })
      ).toBe("/repo/.custom-state")

      expect(
        resolveHarnessStateDir("/repo", { HARNESS_STATE_DIR: "/tmp/custom-state" })
      ).toBe("/tmp/custom-state")
    })
  })
})
