---
id: es:ADR-0001
title: Pure Decider Pattern with R = never and Emmett-Style No-Op Idempotency
status: accepted
date: 2026-10-28
enforced_by:
  - libs/es/contract/src/index.ts
  - libs/es/domain/src/decider.ts
  - libs/es/domain/src/cart.ts
  - libs/es/domain/src/inventory.ts
spans:
  - Cart.decide
  - Inventory.decide
errors:
  - InvalidQuantityError
  - CartAlreadyCheckedOutError
  - EmptyCartCheckoutError
  - InsufficientStockError
  - ReservationNotFoundError
---

# es:ADR-0001: Pure Decider Pattern with R = never and Emmett-Style No-Op Idempotency

## Context and Problem Statement

Effect v4 provides unstable client-oriented event logs (`effect/eventlog`) and distributed actors (`effect/cluster`), while existing TypeScript Event Sourcing libraries either target Effect v3 (`@codeforbreakfast/eventsourcing-*`), omit Effect's typed error and schema channels (`Castore`), or lack an open-source license (`Emmett`). If aggregate business rules are coupled to Durable Object storage or service layers (`R != never`), domain invariants cannot be verified without spinning up Cloudflare emulation, property-based testing becomes slow and brittle, and duplicate commands from process manager retries risk corrupting aggregate state.

## Decision Drivers

* Business logic (`decide` and `evolve`) must be 100% pure (`R = never`) so unit, property-based (`it.effect.prop`), and AST mutation tests execute in milliseconds without infrastructure Layers.
* Commands that have nothing left to do (such as removing an absent cart SKU, repeating an existing stock reservation, or releasing an already released reservation) must be idempotent no-ops returning an empty event array `[]`.
* Domain rejections must travel in Effect's typed `E` channel via `Schema.TaggedError` classes defined in `@harness/es-contract` so `HttpApi` and RPC boundaries can serialize them deterministically.
* Every domain event must carry an explicit `version` literal in `@harness/es-contract` to support upcasting without rewriting stored event streams.

## Considered Options

* **Option 1: Pure `Decider.make` (`R = never`) with `Schema.TaggedStruct` commands/events, `Schema.TaggedError` rejections, and `[]` no-op arrays**
* **Option 2: Stateful aggregate classes injecting repository services (`R = AggregateStore`) directly inside `decide`**
* **Option 3: Wrapping Castore or `effect/eventlog` directly as the server-side aggregate store**

## Decision Outcome

**Chosen option:** "Option 1: Pure `Decider.make` (`R = never`) with `Schema.TaggedStruct` commands/events, `Schema.TaggedError` rejections, and `[]` no-op arrays".

All aggregate business logic in `libs/es/domain` is expressed through `Decider.make({ initialState, evolve, decide })` where:
1. `evolve(state, event) -> state` is a total, synchronous pure reducer folding stored or newly emitted events into aggregate state.
2. `decide(command, state) -> Effect<ReadonlyArray<Event>, DomainError, never>` is traced with `Effect.fn("<Aggregate>.decide")` and requires zero services (`R = never`).
3. Returning an empty array `[]` signals a valid no-op decision, instructing the aggregate store to write zero rows in its SQLite transaction.
4. `DeciderSpec.for(decider)` provides `given(events).when(command).then(...) / thenNothing() / thenFails(tag)` assertions directly over `@effect/vitest` with zero infrastructure Layers.

## Rejected Alternatives

### 1 · Stateful aggregate classes injecting repository services (`R = AggregateStore`) directly inside `decide`

**Why rejected:** Allowing `decide` to yield storage or queue services (`R != never`) mixes I/O side effects with domain rules, requires mock Layers in every business unit test, and violates the `impure-decider` graph policy in `effect-graph:check`.

### 2 · Wrapping Castore or `effect/eventlog` directly as the server-side aggregate store

**Why rejected:** Castore does not use Effect `Schema` or typed error channels `E`, and `effect/eventlog` is designed for client-side local-first replication rather than single-writer Durable Object aggregate streams with inline SQLite projections.

## Consequences and Enforcement

### Positive Consequences

* `Cart.decide` and `Inventory.decide` run deterministically in milliseconds under `DeciderSpec`, `it.effect.prop` property tests, and `harness mutate --strict`.
* Static graph verification (`checkEffectGraph`) guarantees from the TypeScript type signature alone that no infrastructure service leaks into aggregate business logic.
* Returning `[]` for redundant commands makes command handling naturally idempotent alongside `commandId` deduplication.

### Negative Consequences and Trade-offs

* Any external data required by a decision (such as current timestamp or pre-fetched reference data) must be passed explicitly inside the `Command` payload rather than queried via a service inside `decide`.

### Deterministic Enforcement

| Rule | Enforced By | Gate / Mechanism | Governed Symbols |
| --- | --- | --- | --- |
| Deciders must remain pure with `R = never` | `libs/harness/graph/src/policy-check.ts` | `checkEffectGraph` (`impure-decider` rule) | `Cart.decide`, `Inventory.decide` |
| Every domain decider must have property-based test coverage | `libs/harness/gates/src/gc-check.ts` | `GraphGc.decide` (`missing-decider-property-test`) | `Cart.decide`, `Inventory.decide` |
| Every declared `TaggedError` must be emitted in a domain `E` channel | `libs/harness/gates/src/gc-check.ts` | `GraphGc.decide` (`dead-tagged-error`) | `InvalidQuantityError`, `CartAlreadyCheckedOutError`, `EmptyCartCheckoutError`, `InsufficientStockError`, `ReservationNotFoundError` |
