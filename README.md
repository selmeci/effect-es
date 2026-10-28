# Effect-TS Engineering Harness

The goal is a development harness in which an AI agent plans and codes in the idioms and building blocks of **Effect-TS v4**, enforced deterministically rather than merely suggested in a prompt. The repo runs on **pnpm + Nx**, a dual-layer Effect graph (**`effect/Graph`** in-memory + **Omnigraph `v0.14.0`** on local Lance storage in `.harness/omnigraph/`) indexes the type-checked `Effect<A, E, R>` / `Layer<ROut, E, RIn>` structure, runtime test spans, and pattern files, and a single resident **`clef-flash` (9B) decision model via Ollama** makes bounded local decisions. The harness is **agent-agnostic**: logic lives in the repo as Effect libraries, a CLI, and MCP tools. Each agent gets only a thin adapter. The first adapter prototype targets **Claude Code** (skill, `AGENTS.md`, hooks). The MVP is exercised on a small sample app whose cloud infrastructure is declared with **Alchemy v2**, an Effect-native infrastructure-as-code tool, so infrastructure follows the same idioms, gates, and traces as application code.

## Prerequisites

- **Node.js**: `≥ 24.0.0`
- **pnpm**: `12.9.1` (managed via `corepack enable`)
- **`omnigraph` binary**: `v0.14.0` (single Rust binary on local Lance/Arrow storage in `.harness/omnigraph/` — zero Docker, zero Memgraph, zero Python)
- **Ollama + `clef-flash` (9B)**: Single resident local decision model for semantic triage, guard, router, and per-step plan coverage (phase 2; no 27B model required)
- **`oasdiff` binary**: `v1.33.0` for the OpenAPI breaking-change gate (phase 4)
- **Cloudflare Account**: Required **only** when a human runs `alchemy dev` or `alchemy deploy`. Credentials must be configured via `alchemy profile edit --add Cloudflare`, which securely stores credentials in `~/.alchemy/profiles.json`. Never set `CLOUDFLARE_ACCOUNT_ID` or `CLOUDFLARE_API_TOKEN` environment variables and never use `.env` files.

## Setup

```bash
corepack enable
pnpm install
```

The repository's `prepare` script (`effect-tsgo patch --typescript --oxlint`) automatically patches TypeScript (native TypeScript-Go compiler with Effect diagnostics) and oxlint upon installation.

## Gates & Definition of Done

Every change in the harness must pass deterministic gates before completion. Deterministic gates always win; the decision model never overrides them.

| Gate | What it catches / Enforces | How it runs |
| --- | --- | --- |
| `typecheck` | Floating Effects, Layer requirement leaks, invalid types (including `stub<A, E, R>` skeletons) | `@effect/tsgo` (`tsc --noEmit && effect-tsgo diagnostics --strict`) per project |
| `lint` | Oxlint rules, Effect plugin diagnostics, `@nx/enforce-module-boundaries`, custom syntax bans (`async`/`await`, `try`/`catch`, `throw`, `new Promise`, raw `JSON.parse`, `@effect-diagnostics`, and `stub()` in `verify`), and import bans (`drizzle-orm/*`, `alchemy/*`, `@effect/sql-*`) | `oxlint --deny-warnings .` per project |
| `test` | Unit, property-based (`FastCheck`), and trace-budget test assertions | `@effect/vitest` / Vitest per project |
| `gc` | Zero-entropy graph & governance check (`GraphGc.decide`, `EarsSpecLint.decide`, `AdrDocLint.decide`, `OntologyInvariants.decide`) | `harness gc --strict` |
| `ontology` | Cross-layer ArchiMate 3.2 invariants + Clef semantic conflict detection (`OntologyConflictV1`) | `harness ontology check --strict` |
| `mutate` | AST mutation testing on pure domain deciders (`MutationCheck.decide`, 100% kill score) | `harness mutate --strict` |
| `migration:check` | Drizzle v1 (`1.0.0-rc.5-ab785fc`) schema drift against committed migrations; destructive SQL (`DROP`) escalation | `node scripts/check-migrations.mjs` in infra libraries |
| `verify` | Composite target checking all project gates and writing `.harness/verify-stamp.json` | `harness verify` / `nx affected -t verify` / `pnpm verify:all` |

**Definition of Done:** `nx affected -t verify` is green across all affected projects.

To verify all projects across the workspace:
```bash
pnpm verify:all
```

## Skeleton Planning with `stub<A, E, R>`

During the Plan phase, use-case skeletons use `stub<A, E, R>(...args)` from `@harness/gates`:

```ts
export const checkout = Effect.fn("Cart.checkout")(function* (input: CheckoutInput) {
  return yield* stub<CheckoutReceipt, OutOfStockError | PaymentError, InventoryRepo | PaymentService>(input)
})
```

- During `HARNESS_PLAN_CHECK=1` (`harness plan-check`), `stub<A, E, R>` is allowed and preserves exact inferred `A`, `E`, and `R` channels.
- During `harness verify` / `pnpm verify:all`, `stub(...)` is banned by `harness/syntax-bans`.

## Infrastructure (Alchemy v2)

- The sample application (`apps/sample/alchemy.run.ts`) declares cloud infrastructure using Alchemy v2 (`2.0.0-beta.80`), and its configuration typechecks in every `verify` run.
- `alchemy` and `alchemy/*` imports are banned outside `type:infra` libraries and `apps/sample`.
- `alchemy deploy`, `alchemy destroy`, and `alchemy profile` are **human-only** commands (`ask` verdict in the guard).
- Alchemy documentation snapshots are vendored locally in `docs/alchemy-llms.txt` (index) and `docs/alchemy-llms-full.txt` (per-resource reference). Search these local files directly; do not fetch live documentation.

## Data Layer (Drizzle on D1 / Durable Objects)

- Table schemas (`sqliteTable`) and `drizzle-orm` (`1.0.0-rc.5-ab785fc`) / `@effect/sql-*` imports are strictly confined to `type:infra` libraries. Repositories decode database rows into contract Schemas so that Drizzle types never reach the domain or frontend.
- Migrations are generated by hand with `drizzle-kit generate` and committed to version control (`migrations/<timestamp>_<name>/migration.sql` + `snapshot.json`).
- Running `verify` checks schema drift via `migration:check` and fails (exit 1) if uncommitted schema changes exist. Any migration containing destructive SQL (`DROP` or table rebuilds) escalates to a human operator (exit 2).

## Repository Layout

```
libs/harness/
  decision/          DecisionModel definitions over effect/ai + @effect/ai-typesafe (resident clef-flash)
  ingest/            Effect.fn static index, recording tracer with root TestSpan, workerd trace correlation
  graph/             effect/Graph builder, ArchiMate 3.2 ontology, schema.pg, queries/harness.gq, @modernrelay/omnigraph sync
  gates/             stub<A, E, R> helper, guard policy, EARS/ADR/Ontology gates, mutation testing, session telemetry & report
libs/sample/
  contract/          shared Schemas, HttpApi, RpcGroup, API errors (type:contract)
  domain/            use cases and pure domain logic, no I/O (type:domain)
  infra/             live Layer implementations, Drizzle repositories, migrations (type:infra)
apps/sample/         sample app using Alchemy v2 for Cloudflare infrastructure (type:app)
apps/harness-cli/    harness guard | route | plan-check | verify | done | learn | gc | mutate | ontology | report | ingest | session | doctor
apps/harness-mcp/    Effect MCP server (harness_route, harness_resolve, harness_callers, harness_callees, harness_tests_reaching, harness_structural_search, harness_ontology_why, harness_ontology_impact, harness_ontology_check, harness_gq_query, harness_lsp_diagnostics, harness_telemetry_report)
adapters/
  antigravity/       plugin: hooks.yaml -> harness-cli, mcp_config.json -> harness-mcp + @modernrelay/omnigraph-mcp + nx-mcp, 4 skills
  claude-code/       plugin: hooks.json -> harness-cli, .mcp.json -> harness-mcp + @modernrelay/omnigraph-mcp + nx-mcp, 4 skills
repos/effect/        squashed subtree, read-only
repos/alchemy/       squashed subtree, read-only
agent-patterns/      reviewed pattern files (also indexed as PatternDoc nodes in Omnigraph)
AGENTS.md            agent-neutral rules
```

## Using as a Template & Bidirectional Upstream Sync (`upstream`)

> **Important:** Avoid creating downstream projects via the GitHub UI *"Use this template"* button if you plan to sync harness improvements back and forth. GitHub's template generator squashes history into a new orphan commit with a different SHA, which causes `fatal: refusing to merge unrelated histories` on `git merge` / `git pull`.

To create a new downstream repository (such as [`selmeci/effect-es`](https://github.com/selmeci/effect-es)) that preserves **shared Git commit history** with [`selmeci/effect-ts-harness`](https://github.com/selmeci/effect-ts-harness):

### 1. Bootstrapping a New Project with Shared History

```bash
# Create an empty repository on GitHub (without --template squash)
gh repo create selmeci/<new-project> --public

# Push the clean main branch from effect-ts-harness
git push git@github.com:selmeci/<new-project>.git main:main

# Clone the new project and register effect-ts-harness as upstream
git clone git@github.com:selmeci/<new-project>.git ~/WebstormProjects/<new-project>
cd ~/WebstormProjects/<new-project>
git remote add upstream git@github.com:selmeci/effect-ts-harness.git
git fetch upstream
```

### 2. Pulling Harness Updates into a Downstream Project (`upstream -> origin`)

Whenever new gates, ontology rules, or skills are added to `selmeci/effect-ts-harness`:

```bash
git fetch upstream
git merge upstream/main
```

Because both repositories share the same ancestor commits on `main`, Git performs a clean 3-way merge across `libs/harness/*`, `apps/harness-*`, `agent-patterns/*`, `adapters/*`, and `tools/*` without touching your domain packages (`libs/<scope>/*`).

### 3. Upstreaming Harness Improvements from a Downstream Project (`origin -> upstream`)

When you improve the harness while working in a downstream project (e.g., `selmeci/effect-es`):

1. **Option A — Cherry-pick a dedicated harness commit:**
   Commit your harness changes (`libs/harness/*`, `apps/harness-*`, `agent-patterns/*`, `adapters/*`, `tools/*`) in a separate commit, then cherry-pick it onto `upstream/main`:
   ```bash
   git fetch upstream
   git checkout -b feat/harness-upgrade upstream/main
   git cherry-pick <commit-sha>
   git push upstream feat/harness-upgrade:main
   ```

2. **Option B — Extract harness paths directly onto `upstream/main`:**
   If harness edits were mixed with domain commits on a feature branch (e.g., `feat/es-phase-1-decider-core`):
   ```bash
   git fetch upstream
   git checkout -b feat/harness-upgrade upstream/main
   git checkout <feature-branch> -- libs/harness apps/harness-cli apps/harness-mcp agent-patterns adapters tools
   git commit -m "feat(harness): upstream harness improvements"
   git push upstream feat/harness-upgrade:main
   ```

## Documentation & References

- [AGENTS.md](AGENTS.md): Order of authority, planning idioms, coding standards, and boundary rules for agents.
- [docs/mvp_v2.md](docs/mvp_v2.md): Full MVP v2 architectural specification, empirical audit findings, acceptance criteria, and phase roadmap (supersedes [docs/mvp.md](docs/mvp.md)).

