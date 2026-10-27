---
name: planning-effect-skeletons
description: Use when translating requirements or EARS specifications into a technical plan in an Effect-TS project, before writing implementation bodies or tests.
---

# Planning Effect Skeletons (Plan-as-Code)

## Overview

In this project, the plan IS compilable TypeScript code. Never write long Markdown files containing unverified code blocks. Instead, translate EARS clauses directly into `type:contract` Schemas, `type:service` interfaces, and `stub<A, E, R>(...args)` skeletons in `.ts` files, then verify the topology with `harness plan-check`.

**Violating the letter of the rules is violating the spirit of the rules.**

## Step-by-Step Recipe

1. **Route Idioms:** Call `harness_route` for each non-trivial capability (e.g., D1, Durable Object RPC, `HttpApi`, `AtomHttpApi`) and read the matched `agent-patterns/*.md` file.
2. **Define Boundary Types (`type:contract` & `type:service`):**
   - `WHEN <trigger>` $\rightarrow$ Request/response `Schema.Struct` and `HttpApiEndpoint` / `Rpc` in `type:contract`.
   - `IF <condition>, THEN` $\rightarrow$ `Schema.TaggedErrorClass` in `type:contract`.
   - Stateful capabilities $\rightarrow$ `Context.Service` methods in `type:service`.
3. **Write `stub<A, E, R>()` Skeletons (`type:domain` & `type:infra`):**
   - `WHILE <state>` $\rightarrow$ Pure decider `Effect.fn("<Domain>.decide")` returning `yield* stub<Out, Err, never>(input)` (`R = never` is mandatory).
   - `WHEN <trigger>` $\rightarrow$ Use case `Effect.fn("<Domain>.<useCase>")` returning `yield* stub<A, E, R>(input)` with exact union types for `E` and `R`.
4. **Run the Deterministic Plan Gate:**
   ```bash
   node --import ./tools/node-ts-resolver.mjs apps/harness-cli/src/index.ts plan-check
   ```
   Fix any type error, duplicate span name, or `GraphPolicyViolation` (`domain-requires-infra`, `domain-requires-cloud-binding`, `impure-decider`, `layer-cycle`) until `plan-check` exits `0` and prints the Mermaid graph.
5. **Pre-Implementation Adversarial & Feasibility Lens (for stateful or multi-package plans):** After `harness plan-check` exits `0` and prints the Mermaid graph, audit the skeleton graph against failure modes before dispatching implementers using the [Pre-Implementation Adversarial Plan Lens](references/adversarial-plan-lens.md) (or dispatching [@effect-adversarial-reviewer](../../executing-effect-stubs/references/personas/adversarial-reviewer.md)): verify idempotency keys are present in contract inputs, partial-failure compensation between DO/D1/Queue is represented in `E` and `R`, optimistic concurrency error channels are declared, and no domain `*.decide` function depends on impure services. For reviewer dispatch instructions and personas across all stages, consult the [Reviewer Dispatch Guide](../../executing-effect-stubs/references/dispatch-reviewers.md).

## Skeleton Example

```ts
import { Effect } from "effect"
import { stub } from "@harness/gates"
import { PhotoNotFoundError } from "@harness/sample-contract"
import { AlbumCounterClient, PhotoRepo } from "@harness/sample-service"

export const decideAlbumDecrement = Effect.fn("AlbumDecrement.decide")(function* (input: {
  readonly currentCount: number
}) {
  return yield* stub<number, never, never>(input)
})

export const deletePhoto = Effect.fn("Sample.deletePhoto")(function* (id: number) {
  return yield* stub<void, PhotoNotFoundError, PhotoRepo | AlbumCounterClient>(id)
})
```

## Rationalization Table

| Excuse | Reality |
|---|---|
| "I'll write the plan in a `.md` file with code blocks first" | Uncompiled Markdown code drifts from `effect@4.0.0` types and burns 2x tokens. Write `.ts` skeletons with `stub<A, E, R>()` instead. |
| "I'll use `Effect.die('TODO')` instead of `stub<A, E, R>()`" | `Effect.die` erases `A`, `E`, and `R` to `never`, blinding `effect-graph:check`. Always use `stub<A, E, R>(...args)`. |
| "This feature is small, I'll skip `plan-check` and write the body directly" | `plan-check` snapshots `.harness/plan-graph-snapshot.json` required by `harness done` to verify plan-vs-impl parity. |

## Red Flags — STOP

- Creating a `.md` plan with multi-line TypeScript code blocks instead of `.ts` `stub<A, E, R>()` skeletons
- Writing production `Effect.gen` bodies before `harness plan-check` exits `0`
- Adding `RequiresService` dependencies to a `*.decide` function (`impure-decider`)

**REQUIRED NEXT SKILL:** Once `harness plan-check` exits `0` and outputs the Mermaid graph, use `executing-effect-stubs`.
