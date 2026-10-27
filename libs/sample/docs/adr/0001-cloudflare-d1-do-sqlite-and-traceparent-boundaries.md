---
id: sample:ADR-0001
title: Cloudflare D1 Read Projections, Durable Object Synchronous SQLite State, and W3C Traceparent Propagation
status: accepted
date: 2026-10-26
enforced_by:
  - agent-patterns/durable-object-state.md
  - agent-patterns/d1-repository.md
  - libs/sample/infra/src/index.ts
services:
  - PhotoRepo
  - AlbumCounterClient
---

# sample:ADR-0001: Cloudflare D1 Read Projections, Durable Object Synchronous SQLite State, and W3C Traceparent Propagation

## Context & Problem

Our serverless architecture runs on the Cloudflare Workers edge runtime with distributed components across Workers, Cloudflare D1 (serverless SQLite), and Cloudflare Durable Objects (single-writer stateful actors). This topology poses three critical engineering challenges:

1. **State Contention & Write Races:** D1 databases operate with regional primary nodes and distributed read replicas. Concurrently incrementing counters or quotas directly in D1 leads to database locks, serialization conflicts, and high p99 write latencies under bursty traffic.
2. **Crash Consistency in Durable Objects:** While Durable Objects provide single-threaded execution per actor ID, developers often make the mistake of executing asynchronous operations (such as schema parsing or remote network calls) inside SQLite transactions or updating in-memory state before disk transactions commit, causing state desynchronization if the DO crashes or restarts.
3. **Observability Loss Across RPC Boundaries:** When a Cloudflare Worker invokes a Durable Object via RPC, standard trace contexts break unless distributed tracing headers are explicitly propagated across the RPC boundary.
4. **Data Layer Leaks:** Leaking ORM table schemas (e.g. Drizzle `sqliteTable`) into domain logic couples use-cases to physical database schemas.

## Decision

We establish the following architectural data and persistence boundaries:

1. **Dual Persistence Model: D1 Read Projections vs. DO SQLite State:**
   - **Cloudflare D1 for Read Projections:** All high-volume read models, multi-entity queries, and projections are persisted in D1 and accessed through repositories (e.g., `PhotoRepo`) implemented with Drizzle ORM.
   - **Durable Objects with Co-located SQLite for High-Contention Aggregates:** High-contention aggregates, rate limiters, counters, and quotas (such as `AlbumCounterClient`) must reside inside dedicated Durable Objects backed by co-located synchronous SQLite storage (`ctx.storage.transactionSync`).

2. **Synchronous Transaction Discipline in Durable Objects:**
   - All SQLite writes inside Durable Objects MUST run synchronously via `ctx.storage.transactionSync`.
   - Asynchronous Effect evaluation, network calls, and schema decoding MUST execute *before* or *after* the synchronous SQLite transaction block.
   - In-memory state (`Ref`) may only be updated *after* the SQLite transaction has successfully committed to disk, ensuring crash-recovery parity.

3. **W3C Traceparent Header Propagation:**
   - Every Worker-to-Durable-Object RPC call and inter-service HTTP request must extract the current Effect `FiberRef` trace context and inject the standard `traceparent` (and `tracestate`) header.
   - The receiving Durable Object RPC handler extracts this header and wraps execution within an Effect span using the propagated parent trace ID, maintaining unbroken distributed traces in `runWithTestTracer` and production APM.

4. **Strict Encapsulation in `type:infra`:**
   - Drizzle schemas (`sqliteTable`), SQL builders, and raw storage drivers are strictly isolated to `type:infra`.
   - Repositories decode database rows into contract Schemas (`type:contract`) before returning values to `type:domain`. Domain logic never observes raw database types.

## Rejected Alternatives

### 1. Using D1 for High-Contention Per-Aggregate/Counter Mutations
- **Why rejected:** Attempting to update per-album photo counts or user quotas directly in D1 requires repeated `UPDATE ... SET count = count + 1` queries under high concurrency. This causes lock contention on D1, transaction retries, and high p99 latencies. Durable Objects provide localized single-threaded serialization with sub-millisecond in-memory SQLite performance.

### 2. Running Async Operations Inside DO `transactionSync` or Mutating `Ref` Before Commit
- **Why rejected:** In Cloudflare Durable Objects, `ctx.storage.transactionSync` prohibits asynchronous promises; attempting to yield asynchronous operations inside a synchronous transaction throws runtime exceptions. Furthermore, mutating an in-memory `Ref` before the SQLite commit finishes causes phantom state: if the Worker crashes before commit, memory will reflect a change that was never committed to durable storage.

### 3. Leaking Drizzle Table Types Outside `type:infra`
- **Why rejected:** Exposing Drizzle ORM table models or SQL row types to `type:domain` or `scope:web` breaks the Nx taxonomy. Database schema migrations would force breaking changes onto domain use-cases and frontend components. Decoding into contract Schemas at the repository boundary guarantees clean domain isolation.

## Consequences & Enforcement

### Positive Consequences
- **Predictable Performance:** Fast, non-blocking reads from D1 and zero-contention writes serialized by Durable Objects.
- **True Crash Durability:** The state of Durable Objects after restart matches disk commits exactly.
- **Distributed Observability:** Complete span trees cross the Worker-to-DO RPC boundary seamlessly.

### Negative Consequences / Trade-offs
- Requires maintaining two persistence mechanisms: Drizzle migrations for D1 and raw synchronous SQLite tables for Durable Objects.

### Enforcement
- **`agent-patterns/durable-object-state.md`:** Documents the exact pattern for synchronous DO SQLite transactions and in-memory `Ref` synchronization.
- **`agent-patterns/d1-repository.md`:** Documents Drizzle repository implementation with contract schema decoding.
- **`libs/sample/infra/src/index.ts`:** Implements `PhotoRepo` and `AlbumCounterClient` adhering to these boundaries.
- **`Reliability & Concurrency Lens`:** Inspects DO transaction blocks for async operations and proper finalizers.
- **`GraphGc.decide`:** Verifies service tag connectivity and detects stale references.
