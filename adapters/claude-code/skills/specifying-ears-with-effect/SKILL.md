---
name: specifying-ears-with-effect
description: Use when starting any new feature, requirement, or behavior change before writing code or skeletons, especially when requirements are informal, incomplete, or lack EARS clauses.
---

# Specifying EARS with Effect

## Overview

Turn informal feature ideas into an unambiguous **EARS (Easy Approach to Requirements Syntax)** specification grounded in the existing Effect graph before writing any code or skeletons.

**Violating the letter of the rules is violating the spirit of the rules.**

## Discovery & Interview Sequence

1. **Inspect Existing Graph First:** Call `harness_resolve` and `harness_callers` on related domain symbols (`EffectFn`, `ServiceTag`, `TaggedError`) so questions are grounded in the actual codebase.
2. **Clarify Ambiguities (One Question at a Time):** Ask at most one targeted question per turn to resolve missing failure conditions (`IF/THEN`) or state invariants (`WHILE`).
3. **Emit the EARS Specification Contract:** Present the final specification in the exact structure below and get user confirmation before moving to skeleton planning.

## Output Contract (Positive Recipe)

Every specification produced by this skill has three parts, in order:

```markdown
### 1. Existing Graph Context
- **Reused Contracts / Errors:** `<symbols from type:contract>`
- **Reused Services:** `<Context.Service tags from type:service>`
- **New Capabilities Needed:** `<new schemas, errors, or service methods>`

### 2. EARS Requirements
- **UBIQUITOUS:** THE SYSTEM SHALL <core domain invariant>.
- **EVENT-DRIVEN:** WHEN <trigger/input>, THE SYSTEM SHALL <happy-path outcome A>.
- **UNWANTED:** IF <failure condition>, THEN THE SYSTEM SHALL fail with `<TaggedError>` (`E` channel).
- **STATE-DRIVEN:** WHILE <state invariant>, THE SYSTEM SHALL <enforce via pure `.decide` (`R = never`)>.
- **OPTIONAL:** WHERE <feature/config>, THE SYSTEM SHALL <provide via `Layer` / `Config` in `R`>.

### 3. Affected Nx Packages
- `type:contract` -> `type:service` -> `type:domain` -> `type:infra` -> `scope:web`
```

## Rationalization Table

| Excuse | Reality |
|---|---|
| "The user said 'quickly / no time', so I'll invent default assumptions silently" | Silent assumptions on quotas, errors, or persistence cause full rewrites across 4 Nx tiers. Confirm EARS clauses first. |
| "I can write a prose Markdown implementation plan instead of EARS" | Prose plans hide missing `E` (error) and `WHILE` (pure `.decide`) channels. EARS maps 1:1 to `Effect<A, E, R>`. |
| "I don't need `harness_resolve` before asking questions" | Asking without checking the graph wastes the user's time on things already defined in `type:contract` or `type:service`. |

## Red Flags — STOP

- Starting to edit `.ts` files before EARS clauses (`WHEN`, `IF/THEN`, `WHILE`) are stated
- Writing full implementation code inside a `.md` plan file
- Inventing domain error or quota rules without checking `harness_resolve`

**REQUIRED NEXT SKILL:** After the user approves the EARS specification, use `planning-effect-skeletons`.
