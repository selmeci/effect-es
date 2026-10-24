import { Effect, Layer, Schema } from "effect"
import * as Decision from "effect/ai/Decision"
import * as DecisionModel from "effect/ai/DecisionModel"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import { TypeSafeClient, TypeSafeDecisionModel } from "@effect/ai-typesafe"

/** Ordered building blocks; `review` first is a deliberate mitigation for Clef-flash's
 * weak out-of-scope detection (ties follow option order, mvp.md "Decision model"). */
export const IDIOM_BLOCKS = [
  "review",
  "schedule",
  "stream",
  "scope",
  "queue",
  "concurrency",
  "schema",
  "effect"
] as const
export type IdiomBlock = (typeof IDIOM_BLOCKS)[number]

/** Versioned decision definition: reviewed data, not a prompt string. */
export const IdiomRouterV1 = Decision.make({
  input: Schema.Struct({ planStep: Schema.String }),
  decisions: {
    fitsAny: Decision.probability({
      instructions: "Does this step map to a single Effect building block?"
    }),
    block: Decision.classify({
      instructions: "Which Effect building block best implements this step?",
      criteria: {
        review: "Unclear or spans multiple blocks",
        schedule: "Retries, repetition, backoff, timing policies",
        stream: "Incremental or unbounded sequences of values",
        scope: "Acquiring and releasing resources",
        queue: "Producer/consumer handoff, PubSub",
        concurrency: "Forking fibers, racing, parallel work",
        schema: "Decoding, encoding, validating data at a boundary",
        effect: "Plain sequential effectful logic"
      }
    })
  }
})

export const routeStep = Effect.fn("Harness.routeStep")(function* (planStep: string) {
  const { answers } = yield* DecisionModel.decide(IdiomRouterV1, { input: { planStep } })
  yield* Effect.annotateCurrentSpan({
    "decision.definition": "IdiomRouterV1",
    "decision.block": answers.block.label,
    "decision.fitsAny": answers.fitsAny.probability
  })
  return answers.fitsAny.probability >= 0.7 ? answers.block.label : "review"
})

/** Local Clef-flash through Ollama's System One endpoint. */
export const LocalDecisionModel = TypeSafeDecisionModel.layer({ model: "clef-flash" }).pipe(
  Layer.provide(TypeSafeClient.layer({ apiUrl: "http://localhost:11434/v1" })),
  Layer.provide(FetchHttpClient.layer)
)
