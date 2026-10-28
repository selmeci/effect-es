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
* **Framework Boundary Isolation:** Framework packages (`@harness/es-contract`) must export only domain-agnostic event sourcing primitives (`EventMetadata`, `Decider`, `DeciderSpec`), keeping sample domain models (`Cart`, `Inventory`) isolated in test fixtures.
* **Emmett-Style Given/When/Then DSL:** Developers must be able to specify aggregate behavior using partial event matching, typed failure assertion, and explicit no-op assertions (`[]`).
* **Deterministic Verification:** Decider purity and error propagation must be statically enforceable by the harness graph linter (`checkEffectGraph`).

## Considered Options

* **Option 1:** Adopt Castore or Emmett directly via runtime adapters.
* **Option 2:** Pure Decider pattern (`decide` + `evolve` + `fold` + `Decider.run`) on Effect v4 with Emmett-inspired `DeciderSpec` and versioned Effect Schemas, isolated from domain applications.

## Decision Outcome

**Chosen option:** "Option 2: Pure Decider pattern with Emmett-style DeciderSpec and versioned Effect Schemas, isolated from domain applications".

### Rules

1. **Decider Signature Purity:** `decide` functions must have signature `(command: Command, state: State) => Effect.Effect<ReadonlyArray<Event>, Error, never>`.
2. **State Reducer Purity:** `evolve` functions must be total, synchronous, pure functions `(state: State, event: Event) => State`.
3. **No-Op Semantics:** When a command requires no state change, `decide` must return an empty array `[]`.
4. **Framework Separation:** No e-commerce or specific domain logic may be exported by `@harness/es-contract`.
5. **DSL Specifications:** Decider tests must use `DeciderSpec.for(decider).given(events).when(command).thenEvents(...) / thenNothing / thenFails(...)`.

## Rejected Alternatives

### 1 · Castore / Emmett Direct Adoption

**Why rejected:** Castore (last released in April 2025) targets Effect v3 paradigms and lacks native `Schema.TaggedErrorClass` error channels and Effect tracing spans. Emmett lacks a permissive license and does not integrate natively with Effect's Fiber runtime or Layer graphs.

## Consequences and Enforcement

### Positive Consequences

* Domain logic executes with zero dependencies (`R = never`), eliminating test flakiness and mocking overhead.
* Framework consumers receive a clean, minimal dependency footprint without unneeded domain schemas.
* Tests run in milliseconds under `@effect/vitest` without starting Cloudflare Workers or Miniflare instances.

### Negative Consequences and Trade-offs

* In-memory replay (`fold`) requires loading all past events for an aggregate on activation. Snapshotting will be required post-MVP for large streams.

### Deterministic Enforcement

| Rule | Enforced By | Gate / Mechanism | Governed Symbols |
|---|---|---|---|
| Decider purity (`R = never`) | `libs/es/contract/src/decider.ts` | TypeScript 7 & `@effect/tsgo` | `Decider.run` |
| Framework boundary isolation | `libs/es/contract/src/index.ts` | `oxlint` & `pnpm run verify` | `EventMetadata`, `Decider` |
| BDD test assertions | `libs/es/contract/src/decider.ts` | `@effect/vitest` | `DeciderSpec` |
