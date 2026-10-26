---
name: compounding-effect-learnings
description: Use after completing a task that encountered route misses, repeated verify failures, or new Effect v4 / Alchemy v2 patterns, or when running harness learn to promote friction into deterministic gates and pattern recipes.
---

# Compounding Effect Learnings (Zero-Context-Bloat Loop)

## Overview

Turn task friction recorded in `.harness/friction-log.jsonl` into permanent, zero-context-bloat harness assets instead of dumping prose into `AGENTS.md`.

**Violating the letter of the rules is violating the spirit of the rules.**

## The 4 Promotion Targets (Graduation Pyramid)

1. **`agent-pattern` (`route_miss`):** Create or update `agent-patterns/<block>.md` (50–80 lines, concrete Effect v4 / Alchemy v2 code) and register `<block>` in `IDIOM_BLOCKS` & `IdiomRouterV1` in `libs/harness/decision/src/idiom-router.ts` (up to 26 options total).
2. **`triage-rule` (`verify_failure`):** For mechanical/compiler/test errors, add `{ pattern, result: { kind, hint } }` to `DETERMINISTIC_TRIAGE_RULES` in `libs/harness/decision/src/triage-decision.ts` for `0 ms` instant feedback.
3. **`guard-allowlist` (`guard_escalation`):** For recurring safe CLI commands, add prefix to `ALLOWLIST` in `libs/harness/gates/src/policy.ts`.
4. **`ast-graph-gate` (architectural/syntax anti-pattern):** Promote recurring violations into `tools/oxlint/syntax-bans.js` or `libs/harness/graph/src/policy-check.ts` so future agents cannot repeat the mistake.

## Step-by-Step Recipe

1. **Inspect Friction Clusters:** Run `node --import ./tools/node-ts-resolver.mjs apps/harness-cli/src/index.ts learn` to inspect grouped `.harness/friction-log.jsonl` clusters and `LearnProposalV1` (`clef-flash`) recommendations.
2. **Apply Approved Promotion:** Present the actionable proposals to the user and apply the approved promotion (`agent-pattern`, `triage-rule`, `guard-allowlist`, or `ast-graph-gate`).
3. **Verify and Clear:**
   ```bash
   node --import ./tools/node-ts-resolver.mjs apps/harness-cli/src/index.ts verify
   node --import ./tools/node-ts-resolver.mjs apps/harness-cli/src/index.ts learn --clear
   ```

## Rationalization Table

| Excuse | Reality |
|---|---|
| "I'll append a rule into `AGENTS.md`" | Prose in `AGENTS.md` burns prompt tokens on every turn. An `agent-pattern` or deterministic gate costs 0 extra prompt tokens until triggered. |
| "A single verify error doesn't need a triage rule" | Repeated compiler/test errors waste developer turns. Adding a regex to `DETERMINISTIC_TRIAGE_RULES` gives future runs instant 0ms hints. |
| "I can clear friction logs without promoting" | Clearing unaddressed friction discards hard-won engineering learnings. Always promote recurring friction before `--clear`. |

## Red Flags — STOP

- Dumping prose reminders or warnings into `AGENTS.md`
- Hardcoding complex multi-step instructions where an AST rule or compiler check is possible
- Clearing `.harness/friction-log.jsonl` before applying or declining actionable promotions
