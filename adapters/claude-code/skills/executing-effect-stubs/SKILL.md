---
name: executing-effect-stubs
description: Use when stub<A, E, R>() skeletons have passed plan-check and are ready to be replaced with production Effect implementations and tests across one or more packages.
---

# Executing Effect Stubs (Subagent-Driven Implementation)

## Overview

Once `harness plan-check` has locked the `type:contract` Schemas, `type:service` interfaces, and `stub<A, E, R>()` signatures, replace every stub with a tested production implementation. For multi-package work, dispatch fast `flash` subagents per package boundary (`type:domain`, `type:infra`, `scope:web`), review their diffs, and close with `harness verify` and `harness done`.

**Violating the letter of the rules is violating the spirit of the rules.**

## Execution Recipe

### 1. Partition by Nx Taxonomy (`flash` Subagents)
Because `type:contract` and `type:service` are already compiled and locked by `plan-check`, work in downstream packages is isolated:
- **Unit A (`type:domain`):** Replace `*.decide` and use-case `stub<A, E, R>()` calls; test with `@effect/vitest` (`it.effect`) + `runWithTestTracer` + in-memory test `Layer`s.
- **Unit B (`type:infra`):** Implement Drizzle D1 / Durable Object `Layer`s (decoding rows into contract Schemas; synchronous DO SQLite transactions; W3C `traceparent` headers) and test with `@effect/vitest`.
- **Unit C (`scope:web`):** Derive `AtomHttpApi` query/mutation atoms from `type:contract` (zero raw `fetch`).

When launching parallel subagents that run CLI or build commands concurrently, isolate their workspaces using an isolated git worktree with `HARNESS_WORKTREE_ID=<unit>` (e.g. `HARNESS_WORKTREE_ID=unit-a`) or `Workspace: "share"` so `.harness/worktrees/<id>` state files and stamps never collide.

When delegating a unit to an implementer subagent, provide this exact 4-part prompt:
1. **Target Stubs & Files:** Exact file paths and `Effect.fn("SpanName")` stubs to replace.
2. **EARS Acceptance Clauses:** The `WHEN`, `IF/THEN`, and `WHILE` clauses that must each have a matching `it.effect(...)` test.
3. **Pattern Reference:** Path to the relevant `agent-patterns/*.md` file (e.g., `agent-patterns/d1-repository.md`, `agent-patterns/durable-object-state.md`).
4. **Package Gate:** `CI=true pnpm nx run <project>:verify` (must pass with 0 active `stub()` calls in that package).

### 2. Implement & Write `@effect/vitest` Trace Tests
Implement the production code and tests within each package boundary:
- Write `@effect/vitest` tests (`it.effect`) validating every EARS requirement with `runWithTestTracer`.
- Check span budgets using `checkSpanBudgets` (`SpanBudget.decide`) on recorded spans to prevent N+1 query/RPC repetitions (`maxRepeatedChildCalls` threshold, e.g. $\le 3$) and ensure latency budgets (`maxSpanDurationMs`) are honored.
- Keep `*.decide` deciders strictly pure (`R = never`), confining side effects and cloud bindings to `type:infra`.

### 3. Final Verification & Closeout (Controller Only)
1. **Subagent Review (`model: "flash"`):** For non-trivial units, dispatch a read-only reviewer subagent to check spec compliance (all EARS clauses tested, no `syntax-bans` workarounds, no Drizzle types leaking out of `type:infra`).
2. **Graph Garbage Collection & Entropy Check:** Run the entropy scanner before verification:
   ```bash
   node --import ./tools/node-ts-resolver.mjs apps/harness-cli/src/index.ts gc
   ```
   This invokes `GraphGc.decide` to verify zero dead `TaggedError`s (`dead-tagged-error`), unused/unprovided `ServiceTag`s (`unused-service`, `unprovided-service`), orphan `Effect.fn`s (`orphan-effect-fn`), or missing pattern documentation (`missing-pattern-doc`).
3. **Whole-Workspace Deterministic Gate:** Run the ONLY sanctioned completion sequence:
   ```bash
   CI=true node --import ./tools/node-ts-resolver.mjs apps/harness-cli/src/index.ts verify
   CI=true node --import ./tools/node-ts-resolver.mjs apps/harness-cli/src/index.ts done
   ```

## Rationalization Table

| Excuse | Reality |
|---|---|
| "I'll implement all 4 layers in one giant turn myself" | Monolithic edits across `domain`, `infra`, and `web` pollute context. Locked `stub<A, E, R>()` boundaries let `flash` subagents implement each package cleanly. |
| "Unit tests passed in `vitest`, so I don't need `harness verify`" | Only `harness verify` checks for leftover `stub()` calls, runs `checkEffectGraph`, and writes `.harness/verify-stamp.json`. Without it, `harness done` (and the `Stop` hook) blocks completion. |
| "I tweaked a comment/file after `harness verify`, no need to re-run" | `.harness/verify-stamp.json` hashes the entire working tree via SHA-256. Any post-verify file edit invalidates the stamp. |
| "harness gc isn't necessary if TypeScript builds" | TypeScript does not check for unused `TaggedError`s, unprovided service tags in layers, or missing pattern documentation. `harness gc` stops code entropy before it merges. |

## Red Flags — STOP

- Leaving any `stub()` call in production code during `verify`
- Using `async/await`, `try/catch`, `throw`, raw `JSON.parse`, or raw `fetch()` in `scope:web`
- Dead `TaggedError`s or unprovided `ServiceTag`s detected by `harness gc`
- N+1 query/RPC repetitions violating `checkSpanBudgets`
- Claiming task completion without a fresh `.harness/verify-stamp.json` and a passing `harness done`

**OPTIONAL FOLLOW-UP SKILL:** If the task encountered route misses or repeated verify failures, use compounding-effect-learnings (harness learn).
