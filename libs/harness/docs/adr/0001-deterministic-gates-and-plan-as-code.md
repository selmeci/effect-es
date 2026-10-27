---
id: harness:ADR-0001
title: Deterministic Gates and Compilable Plan-as-Code Skeletons Over Prose Plans
status: accepted
date: 2026-10-25
enforced_by:
  - libs/harness/gates/src/stub.ts
  - libs/harness/graph/src/policy-check.ts
  - libs/harness/gates/src/policy.ts
spans:
  - GraphGc.decide
  - SpanBudget.decide
  - MigrationSafety.decide
  - MutationCheck.decide
  - LoopCircuitBreaker.decide
---

# harness:ADR-0001: Deterministic Gates and Compilable Plan-as-Code Skeletons Over Prose Plans

## Context & Problem

Autonomous coding agents (e.g., Claude Code, Antigravity) operating on complex Effect-TS codebases frequently suffer from severe context degradation and hallucination during multi-step tasks. In traditional workflows:
1. Agents write expansive, prose-heavy Markdown implementation plans containing dozens of lines of unverified, uncompiled TypeScript snippets.
2. By the time implementation begins, these code snippets drift from actual compiler types (`effect@4.0.0`), violate Nx package boundaries, or invent non-existent APIs.
3. Teams attempt to compensate by using high-temperature LLM-as-a-Judge evaluators to review or gate pull requests, resulting in stochastic, non-reproducible CI failures and high token costs.
4. When planning stubs are introduced, agents commonly reach for `Effect.die("TODO")` or `throw new Error("TODO")`, which completely erases the input, error (`E`), and context (`R`) channels in TypeScript's type system, blinding static analysis tools.

We need an architectural mechanism that guarantees 100% type preservation and boundary compliance *before* implementation begins, with zero tolerance for probabilistic build gates.

## Decision

We establish two foundational architectural rules for the harness:

1. **Compilable Plan-as-Code Skeletons Over Prose Plans:**
   - Planning is not a prose exercise. The plan **IS** compilable TypeScript code committed directly to `.ts` files in the workspace.
   - Skeletons must use `stub<A, E, R>(...args)` from `@harness/gates`. This consumes arguments to satisfy linters while preserving the precise output (`A`), error (`E`), and service dependency (`R`) channels across all 4 Nx package tiers (`contract`, `service`, `domain`, `infra`).
   - The skeleton phase is guarded by `harness plan-check`, which compiles the entire workspace (`HARNESS_PLAN_CHECK=1`), verifies span name uniqueness, validates graph architectural policies (`domain-requires-infra`, `impure-decider`, `layer-cycle`), and snapshots the topology into `.harness/plan-graph-snapshot.json`.

2. **Deterministic Gates Always Win Over LLMs:**
   - High-level decision models (such as local `clef-flash`) operate strictly in an **advisory** capacity with hard timeouts (`1500 ms`) and pure deterministic fallbacks.
   - All quality, safety, and completion criteria are enforced by fast, deterministic mechanisms:
     - Statics & bans: `oxlint` with `tools/oxlint/syntax-bans.js`.
     - Graph policies: `checkEffectGraph` in `libs/harness/graph/src/policy-check.ts`.
     - Zero entropy: `GraphGc.decide` (`harness gc --strict`).
     - Performance regressions: `SpanBudget.decide`.
     - Migration safety: `MigrationSafety.decide`.
     - Final task gating: Cryptographic SHA-256 tree hashing in `.harness/verify-stamp.json` verified by `harness done`.

## Rejected Alternatives

### 1. Prose Markdown Plans with Uncompiled TypeScript Code Blocks
- **Why rejected:** Prose Markdown plans with embedded TypeScript snippets drift rapidly from compiler reality. They burn valuable context window tokens (up to 40% of context consumed by unverified text) and cannot be validated by `tsc` or `effect/Graph`. Skeletons in actual `.ts` files ensure compiler-checked validity before a single line of business logic is authored.

### 2. High-Temperature LLM-as-a-Judge Gating Builds
- **Why rejected:** Using a remote LLM to "judge" whether a plan or implementation is sound introduces non-determinism, network latency, and cost into the feedback loop. An LLM judge will miss subtle type channel erasures (`never` leaks) or cyclical layer imports that a deterministic compiler or AST graph check catches in single-digit milliseconds.

### 3. `Effect.die("TODO")` Skeletons
- **Why rejected:** `Effect.die` returns `Effect<never, never, never>`. This collapses all type parameters to `never`, blinding downstream packages and `effect/Graph` extractors. Downstream callers cannot know which errors to catch (`catchTag`) or which services to provide (`Layer`). In contrast, `stub<A, E, R>(...args)` forces explicit declaration of all three channels and allows `harness verify` to mechanically catch leftover stubs prior to release.

## Consequences & Enforcement

### Positive Consequences
- **Zero Type Drift:** Skeletons are verified by the real TypeScript compiler and `oxlint` before implementation starts.
- **Instant Mechanical Feedback:** Build failures produce deterministic errors in milliseconds rather than subjective review comments.
- **Plan-Implementation Parity:** `harness done` compares `plan-graph-snapshot.json` with the post-verification graph snapshot to ensure no planned capabilities were silently skipped.

### Negative Consequences / Trade-offs
- Engineers and agents must think through error types and service dependencies upfront during Step 1 (EARS) and Step 2 (Skeletons) rather than discovering them ad-hoc during implementation.

### Enforcement
- **`libs/harness/gates/src/stub.ts`:** Implements `stub<A, E, R>(...args)` to preserve types and track active stubs.
- **`libs/harness/graph/src/policy-check.ts`:** Enforces layer boundaries and pure deciders (`R = never`).
- **`tools/oxlint/syntax-bans.js`:** Bans `Effect.die("TODO")` and unhandled promise/async paradigms.
- **`GraphGc.decide`:** Scans for orphaned nodes, unprovided services, and stale doc references.
- **`SpanBudget.decide` & `MigrationSafety.decide`:** Deterministically guard performance and persistence schemas.
