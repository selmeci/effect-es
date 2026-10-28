---
id: es:ADR-0001
title: Pure Decider Pattern with Emmett-Style Specification Testing and Versioned Schemas
status: accepted
date: 2026-10-28
enforced_by:
  - libs/es/contract/src/decider.ts
  - libs/es/contract/src/index.ts
spans:
  - Decider.run
services: []
errors: []
---

# es:ADR-0001: Pure Decider Pattern with Emmett-Style Specification Testing and Versioned Schemas

## Context and Problem Statement

Effect v4 lacks an active, idiomatic aggregate event-sourcing framework. Community libraries are anchored to Effect v3, while generic TypeScript libraries (Castore, Emmett) lack native Effect Schema integration, typed tagged errors, and tracing spans. We need a lightweight, reusable event sourcing core where domain business rules are totally decoupled from Cloudflare Durable Object SQLite storage and framework code is decoupled from application domains (e-commerce, inventory).

## Decision Drivers

* **Zero-Infrastructure Domain Logic:** Aggregate deciders (`decide`) and state reducers (`evolve`) must require zero external services (`R = never`), allowing comprehensive BDD and property testing without mocks or emulators.
* **Framework Boundary Isolation:** Framework packages (`@harness/es-contract`) must export only domain-agnostic event sourcing primitives (`EventMetadata`, `CommandResult`, `Decider`, `DeciderSpec`), keeping sample domain models (`Cart`, `Inventory`) isolated in test fixtures.
* **Emmett-Style Given/When/Then DSL:** Developers must be able to specify aggregate behavior using partial event matching, typed failure assertion, and explicit no-op assertions (`[]`).
* **Deterministic Verification:** Decider purity (`R = never`) and error propagation must be statically enforced by the TypeScript compiler (`tsc` / `@effect/tsgo`) and deterministic test runners, ensuring deciders remain dependency-free without runtime mocks.
* **Closed Discriminated Unions:** States and command outcomes must be modeled with closed tagged unions (`CommandResult` = `Created` | `Appended`, `CartState` = `Empty` | `Open` | `CheckedOut`), never with boolean flags or optional properties.

## Considered Options

* **Option 1:** Adopt Castore or Emmett directly via runtime adapters.
* **Option 2:** Pure Decider pattern (`decide` + `evolve` + `fold` + `Decider.run`) on Effect v4 with Emmett-inspired `DeciderSpec` and versioned Effect Schemas, isolated from domain applications.

## Decision Outcome

**Chosen option:** "Option 2: Pure Decider pattern with Emmett-style DeciderSpec and versioned Effect Schemas, isolated from domain applications".

### Rules

1. **Decider Signature Purity:** `decide` functions must have signature `(command: Command, state: State) => Effect.Effect<ReadonlyArray<Event>, Error, never>`.
2. **State Reducer Purity:** `evolve` functions must be total, synchronous, pure functions `(state: State, event: Event) => State`.
3. **No-Op & Idempotency Semantics:** When a command requires no state change (e.g. idempotent retries, or releasing an unheld reservation during saga compensation/rollback), `decide` must return an empty array `[]`. Confirming a non-existent hold is invalid and fails with a typed domain error (`ReservationNotFoundError`), whereas releasing a non-existent hold is a safe idempotent no-op.
4. **Closed Discriminated Unions:** Framework and domain models forbid boolean lifecycle flags (e.g. `created: Schema.Boolean`, `checkedOut: Schema.Boolean`). `CommandResult` is represented as a closed tagged union (`Created` with `NonEmptyArray` & `Natural` stream version vs. `Appended` with `Array` & `Natural` stream version).
5. **Framework Separation:** No e-commerce or specific domain logic may be exported by `@harness/es-contract`.
6. **DSL Specifications:** Decider tests must use `DeciderSpec.for(decider).given(events).when(command).thenEvents(...) / thenNothing / thenFails(...)`.

## Rejected Alternatives

### 1 · Castore / Emmett Direct Adoption

**Why rejected:**
* **Castore:** Plain TypeScript event sourcing library that predates Effect v3/v4. While community adapters existed for Effect, it is not built natively on Effect v4's `Schema`, `Schema.TaggedError`, or Fiber tracing, requiring bridge layers and losing compile-time type inference.
* **Emmett:** Oskar Dudycz's plain TypeScript event-sourcing library with EventStoreDB/PostgreSQL focus, released under Apache 2.0. Emmett provides an excellent programming model that inspired `DeciderSpec`, but is designed for plain TypeScript runtimes without native Effect v4 Fiber, Schema, or Layer dependency injection.

## Consequences and Enforcement

### Positive Consequences

* Domain logic executes with zero dependencies (`R = never`), eliminating test flakiness and mocking overhead.
* Framework consumers receive a clean, minimal dependency footprint without unneeded domain schemas.
* Compile-time type safety ensures all states and outcomes are exhaustively handled via `ts-pattern` without boolean flag ambiguity.
* Tests run in milliseconds under `@effect/vitest` without starting Cloudflare Workers or Miniflare instances.

### Negative Consequences and Trade-offs

* In-memory replay (`fold`) requires loading all past events for an aggregate on activation. Snapshotting will be required post-MVP for large streams.

### Deterministic Enforcement

| Rule | Enforced By | Gate / Mechanism | Governed Symbols |
|---|---|---|---|
| Decider purity (`R = never`) | `libs/es/contract/src/decider.ts` | TypeScript 7 & `@effect/tsgo` | `Decider.run` |
| Framework boundary isolation | `libs/es/contract/src/index.ts` | Architecture lint & `pnpm run verify` | `libs/es/contract/src/index.ts` |
| BDD test assertions | `libs/es/contract/src/decider.ts` | `@effect/vitest` | `Decider.run` |
