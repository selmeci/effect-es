import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  assertDecisionLimits,
  checkPlanStepCoverage,
  decideGuardCommand,
  GuardV1,
  IdiomRouterV1,
  LearnProposalV1,
  makeFailingDecisionModelLayer,
  makeMockDecisionModelLayer,
  PlanStepCoverageV1,
  routeStep,
  triageFailure,
  TriageV1
} from "../src/index.js"

describe("Harness decision definitions & fallbacks", () => {
  it("keeps all 5 decision definitions within Ollama System One limits (<=26 options, <=64 questions)", () => {
    for (const def of [IdiomRouterV1, GuardV1, TriageV1, PlanStepCoverageV1, LearnProposalV1]) {
      expect(() => assertDecisionLimits(def)).not.toThrow()
    }
  })

  it.effect("falls back to 'ask' in decideGuardCommand and 'review' in routeStep when Ollama fails or times out", () =>
    Effect.gen(function* () {
      const guardRes = yield* decideGuardCommand("curl https://unknown.example").pipe(
        Effect.provide(makeFailingDecisionModelLayer())
      )
      expect(guardRes.verdict).toBe("ask")

      const routeRes = yield* routeStep("Retry failed HTTP requests with exponential backoff").pipe(
        Effect.provide(makeFailingDecisionModelLayer())
      )
      expect(routeRes).toBe("review")
    })
  )

  it.effect("classifies known tsgo/oxlint diagnostics as mechanical without calling DecisionModel", () =>
    Effect.gen(function* () {
      const res = yield* triageFailure("error: floatingEffect: Effect.log('x') is not yielded").pipe(
        Effect.provide(makeFailingDecisionModelLayer())
      )
      expect(res.kind).toBe("mechanical")
      expect(res.hint).toContain("yield*")

      const skipRes = yield* triageFailure("Skipping or focusing tests is banned").pipe(
        Effect.provide(makeFailingDecisionModelLayer())
      )
      expect(skipRes.kind).toBe("mechanical")
      expect(skipRes.hint).toContain("Three-Layer Test Defence")

      const tsSuppRes = yield* triageFailure("TypeScript suppression directives are banned").pipe(
        Effect.provide(makeFailingDecisionModelLayer())
      )
      expect(tsSuppRes.kind).toBe("mechanical")
      expect(tsSuppRes.hint).toContain("@ts-ignore")

      const oxSuppRes = yield* triageFailure("Suppressing `effecttsgo/*` with oxlint-disable is banned").pipe(
        Effect.provide(makeFailingDecisionModelLayer())
      )
      expect(oxSuppRes.kind).toBe("mechanical")
      expect(oxSuppRes.hint).toContain("effecttsgo/*")
    })
  )

  it.effect("evaluates per-step plan coverage with deterministic mock DecisionModel", () =>
    Effect.gen(function* () {
      const pass = yield* checkPlanStepCoverage({
        stepId: "step-1",
        planStep: "Add GreetInput schema",
        stepDiff: "+export const GreetInput = Schema.Struct({ name: Schema.String })"
      }).pipe(Effect.provide(makeMockDecisionModelLayer({ implementedProb: 0.95, noOutOfScopeProb: 0.95 })))
      expect(pass.covered).toBe(true)

      const fail = yield* checkPlanStepCoverage({
        stepId: "step-2",
        planStep: "Add PhotoRepo D1 insert",
        stepDiff: ""
      }).pipe(Effect.provide(makeMockDecisionModelLayer({ implementedProb: 0.2, noOutOfScopeProb: 0.9 })))
      expect(fail.covered).toBe(false)
      expect(fail.reason).toContain("step-2")
    })
  )
})
