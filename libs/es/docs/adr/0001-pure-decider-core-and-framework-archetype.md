---
id: es:ADR-0001
title: Pure Decider Core and Framework Archetype Separation
status: accepted
date: 2026-10-29
enforced_by:
  - libs/es/contract/src/index.ts
  - libs/es/core/src/index.ts
spans:
  - Decider.make
  - Decider.decide
  - Decider.evolve
  - DeciderSpec.test
  - Cart.decide
  - Cart.evolve
errors:
  - CartAlreadyCheckedOutError
---

# es:ADR-0001: Pure Decider Core and Framework Archetype Separation

## Context and Problem Statement

Event-sourcing frameworks often conflate domain business rules with storage mechanics, infrastructure bindings, and concurrency controls (e.g. coupling aggregate roots directly to ORM entities, SQL connections, or actor mailboxes). This entanglement makes business logic difficult to test in isolation, prevents fast property-based verification, and encourages accidental I/O or side-effects inside state transition handlers.

Furthermore, when building a reusable event-sourcing framework (`effect-es`), placing concrete business models (such as `Cart` or `Inventory`) into production libraries pollutes library packages and breaks separation of concerns between generic framework protocols and consumer applications.

We need an architectural decision that enforces complete purity of state transition logic (`R = never`) and isolates framework abstractions from concrete sample domains.

## Decision Drivers

* Enforce mathematical purity (`R = never`, `E = never` for reducers) across all state folding and decision functions.
* Enable millisecond BDD testing (`given -> when -> then`) and property-based verification without spinning up emulators, databases, or Cloudflare workers.
* Ensure clear separation between the generic framework archetype (`libs/es/*/src`) and business domain fixtures (`test/fixtures/**`).
* Provide a clean mental model where idempotent commands emit an empty array of events (`[]`).

## Considered Options

* **Option 1:** Pure Decider Pattern (`decide` + `evolve` with `R = never`) and Framework / Fixture Separation.
* **Option 2:** Stateful Aggregate Classes with Injected Repository and Cloudflare Durable Object Bindings.
* **Option 3:** Emmett-style Plain TypeScript Objects with Untyped Exception Throwing.

## Decision Outcome

**Chosen option:** "Pure Decider Pattern (`decide` + `evolve` with `R = never`) and Framework / Fixture Separation"

We establish the foundational architectural rules for the `effect-es` core:

1. **Decider Purity (`R = never`):**
   - Business decisions are evaluated via `decide(command, state)`, returning `Effect<ReadonlyArray<Event>, Error, never>`. No services or environment tags may ever appear in the decider's requirement channel `R`.
   - Reducers (`evolve(state, event) -> State`) must be total, synchronous, and infallible (`R = never`, `E = never`).
   - An empty event array (`[]`) signifies a no-op / idempotent command execution.

2. **Framework Archetype Discipline:**
   - Production packages (`libs/es/contract` and `libs/es/core`) export only generic engine protocols (`Decider`, `Decider.make`, `DeciderSpec`, `EventEnvelope`).
   - Sample domain models (e.g. `Cart`, `CartCommand`, `CartEvent`) reside exclusively in `test/fixtures/**` with `scope:fixture`.

3. **BDD Specification Harness (`DeciderSpec`):**
   - Tests assert behavior via `given(events).when(command).then(events)` or `.thenNothing()` / `.thenFails(error)`.
   - Decider tests run with zero infrastructure layers.

## Rejected Alternatives

### 1 · Stateful Aggregate Classes with Injected Repository Bindings

**Why rejected:** Coupling aggregate state to stateful repositories or Durable Object storage introduces side effects into business decision methods, complicates time-travel debugging and property testing, and makes it impossible to guarantee deterministic replay.

### 2 · Emmett-style Plain TypeScript Objects with Untyped Exception Throwing

**Why rejected:** Relying on JavaScript runtime exceptions (`throw new Error(...)`) completely erases typed error channels (`E`) in Effect-TS, undermines compiler exhaustiveness checks, and prevents typed HTTP/RPC error mapping.

## Consequences and Enforcement

### Positive Consequences

* Deciders can be executed and tested deterministically in sub-millisecond vitest suites without mocking databases or network layers.
* Property-based testing can easily verify totality of `evolve` and determinism of replay using Schema-derived arbitraries.
* Architecture policy tools can verify purity statically from TypeScript types alone.

### Negative Consequences and Trade-offs

* Infrastructure concerns (such as concurrency versioning, Durable Object transactions, and outbox publishing) must be composed in outer layers (Phase 2 and Phase 3).
* Requires strict adherence to discriminated unions and `ts-pattern` exhaustive matching.

### Deterministic Enforcement

| Rule | Enforced By | Gate / Mechanism | Governed Symbols |
|---|---|---|---|
| Decider purity (`R = never`) | `libs/harness/graph/src/policy-check.ts` | `impure-decider` | `Decider.decide`, `Cart.decide` |
| Reducer totality & purity (`R = never`, `E = never`) | `libs/harness/graph/src/policy-check.ts` | `impure-reducer` | `Decider.evolve`, `Cart.evolve` |
| Exhaustive union branching | `tools/oxlint/syntax-bans.js` | `discriminant-branching`, `non-exhaustive-union-match` | `Cart.decide`, `Cart.evolve` |
| Framework archetype boundary | `libs/harness/graph/src/type-extractor.ts` | `findWorkspaceSrcFiles` fixture separation | `Cart.decide`, `Cart.evolve` |
