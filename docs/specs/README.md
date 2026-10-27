# EARS Feature Specifications & Verified Plan Graphs

Tento priečinok a príslušné doménové priečinky uchovávajú **Špecifikácie požiadaviek EARS (Easy Approach to Requirements Syntax)** a **Záznamy overených topologických grafov plánov (Verified Plan Graph Records)** pre jednotlivé funkcie, míľniky a doménové zmeny v repozitári.

Každá špecifikácia v `libs/<scope>/docs/specs/YYYY-MM-DD-<slug>.md` (alebo v koreňovom `docs/specs/` pre prierezové zmeny) slúži ako **trvalá zmluva o správaní (behavioral contract)**, ktorá prežije zhustenie kontextu agenta (`/compact`) a je automaticky overovaná nástrojom `harness gc --strict` a recenzentom `@effect-ears-test-reviewer`.

---

## 1. Konvencia ko-lokovaného monorepa (Co-Located Monorepo Convention)

Pre udržateľnosť a modularitu monorepa uplatňujeme pravidlo ko-lokácie špecifikácií:

1. **Doménovo špecifické EARS špecifikácie:**
   - Ukladajú sa priamo do priečinka príslušnej domény: `libs/<scope>/docs/specs/YYYY-MM-DD-<slug>.md` (napr. `libs/sample/docs/specs/`, `libs/es/docs/specs/`).
   - Používajú scoped identifikátor: `id: <scope>:SPEC-NNNN` (napr. `sample:SPEC-0001`).
2. **Koreňový priečinok `docs/specs/`:**
   - Je vyhradený výhradne pre prierezové, celo-monorepové špecifikácie, ktoré zasahujú viacero domén súčasne.
   - Slúži ako centrálny register a index pre celé monorepo.
3. **Automatické skenovanie v bránach:**
   - Nástroj `harness gc --strict` (`loadGovernanceDocsFromDisk`) automaticky rekurzívne skenuje `libs/*/docs/{adr,specs}`, `apps/*/docs/{adr,specs}` aj koreňové `docs/{adr,specs}`.

---

## 2. Štruktúra a Formát Špecifikácie

Každý súbor špecifikácie obsahuje strojovo čitateľný frontmatter a štandardizovanú kostru:

```yaml
---
id: <scope>:SPEC-NNNN  # napr. sample:SPEC-0001 (alebo SPEC-NNNN pre globálne)
title: Názov funkcie alebo doménového modulu
status: proposed | accepted | superseded | deprecated
date: YYYY-MM-DD
enforced_by:
  - libs/sample/contract/src/index.ts
  - libs/sample/service/src/index.ts
  - libs/sample/domain/src/index.ts
  - libs/sample/infra/src/index.ts
spans:
  - Domain.useCase
  - Domain.decide
services:
  - MyService
errors:
  - MyCustomError
---
```

---

## 3. Životný cyklus špecifikácie (3 fázy governance)

Špecifikácia prechádza tromi fázami životného cyklu zladenými so 6-krokovým procesom harnessu:

### Fáza 1: Vytvorenie návrhu (`specifying-ears-with-effect`)
1. Agent preskúma existujúci kód pomocou MCP nástrojov (`harness_resolve`, `harness_callers`).
2. Sformuluje 3-dielny EARS kontrakt:
   - **1. Existing Graph Context:** Reused Contracts/Errors, Reused Services, New Capabilities.
   - **2. EARS Requirements:** Klauzuly `UBIQUITOUS`, `WHEN` (happy path), `IF/THEN` (typed errors v `E`), `WHILE` (pure decider v `*.decide` s `R = never`), a `WHERE` (config/layer v `R`).
   - **3. Affected Nx Packages:** Postupnosť vrstiev (`contract` $\rightarrow$ `service` $\rightarrow$ `domain` $\rightarrow$ `infra` $\rightarrow$ `web`).
3. Po potvrdení používateľom agent zapíše súbor do `libs/<scope>/docs/specs/YYYY-MM-DD-<slug>.md` (alebo `docs/specs/` pri cross-cutting zmenách) so statusom `status: proposed`. Tým je zaručené, že znenie požiadaviek sa nestratí pri zmenšení okna kontextu (`/compact`).

### Fáza 2: Plán a overenie grafu (`planning-effect-skeletons`)
1. Agent vytvorí kompilovateľný skeleton pomocou `stub<A, E, R>(...args)` v príslušných balíkoch.
2. Spustí bránu `node --import ./tools/node-ts-resolver.mjs apps/harness-cli/src/index.ts plan-check`.
3. Po úspešnom výstupe (`exit 0`) agent aktualizuje súbor špecifikácie:
   - Pripojí vytlačený **Mermaid Topology Graph** zobrazujúci presné väzby medzi funkciami, službami a chybami.
   - Pripojí kontrolný zoznam **Pre-Implementation Adversarial Plan Lens** (overenie idempotencie, kompenzácií a čistoty deciderov).
   - Ak bolo prijaté neobvyklé architektonické rozhodnutie so zamietnutými alternatívami, zapíše zodpovedajúce ADR do `libs/<scope>/docs/adr/NNNN-<slug>.md` (alebo `docs/adr/`).

### Fáza 3: Implementácia a verifikácia (`executing-effect-stubs`)
1. Subagenty nahradia stubs reálnou Effect implementáciou a `@effect/vitest` testami.
2. Pred verifikáciou agent nastaví `status: accepted` v hlavičke špecifikácie.
3. Spustia sa validačné mechanizmy:
   - **`@effect-ears-test-reviewer`:** Skontroluje špecifikáciu `libs/<scope>/docs/specs/YYYY-MM-DD-<slug>.md` a overí, že každá EARS klauzula (`WHEN`, `IF/THEN`, `WHILE`) má citlivé testovacie tvrdenie v testoch.
   - **`harness gc --strict` (`stale-doc-reference`):** Overí, že všetky súbory v `enforced_by` a symboly v `spans`/`services`/`errors` existujú v grafe `HarnessGraph`.
   - **`harness verify` & `harness done`:** Finálne deterministické zapečatenie úlohy.

---

## 4. Integrácia do `HarnessGraph` & Omnigraph (MCP dopytovanie)

Každá EARS špecifikácia je extrahovaná do `HarnessGraph` a lokálneho analytického grafu Omnigraph ako uzol typu **`EarsSpec` (`_tag: "EarsSpec"`)**:

- **Uzol `EarsSpec`:**
  - Obsahuje metadáta: `id` (napr. `sample:SPEC-0001`), `title`, `status`, `date`, relatívnu cestu k súboru `path` a zoznam súborov `enforcedBy`.
- **Hrany `SpecifiesSymbol`:**
  - Z uzla `EarsSpec` smerujú hrany `SpecifiesSymbol` priamo na dotknuté uzly kódu:
    - `EffectFn` uzly (deklarované v poli `spans`),
    - `ServiceTag` uzly (deklarované v poli `services`),
    - `TaggedError` uzly (deklarované v poli `errors`).
- **Priebežná existencia naprieč vetvami Omnigraphu:**
  - Tieto uzly a hrany existujú v lokálnom grafe naprieč vetvami `plan/current`, `impl/current` aj hlavnou vetvou `main`.

### MCP dopytovanie pre autonómnych agentov

Autonómni agenti využívajú MCP nástroje (`apps/harness-mcp`) na navigáciu medzi požiadavkami a symbolmi kódu:
- **`harness_callers("<ServiceOrFn>")`:** Vráti všetky špecifikácie, ktoré daný symbol definujú (`nodeTag: "EarsSpec"`, `edgeKind: "SpecifiesSymbol"`).
- **`harness_callees("<scope>:SPEC-NNNN")`:** Vráti všetky funkcie, služby a chyby vymedzené danou špecifikáciou.
- **`harness_resolve("<scope>:SPEC-NNNN")`:** Vráti podrobné metadáta a umiestnenie špecifikácie na disku.

---

## 5. Dvojstupňové Deterministické Brány: Spec $\rightarrow$ Plan a Plan $\rightarrow$ Impl

Architektúra prepája špecifikácie s kódom pomocou dvoch deterministických kontrol:

### 1. Spec $\rightarrow$ Plan Brána (`unmapped-spec-symbol` v `harness plan-check`)
Aj keď má špecifikácia stav **`status: proposed`**, nástroj `harness plan-check` (`checkEffectGraph`) striktne overuje súlad medzi EARS kontraktom a navrhnutým skeletonom:
- Každý `span`, `service` a `error` deklarovaný v YAML frontmatteri špecifikácie **musí existovať** ako uzol v grafe skeletonu (`stub<A, E, R>()`).
- Ak agent v špecifikácii navrhne požiadavku vyžadujúcu span `Sample.deletePhoto` alebo službu `PhotoRepo`, no v TypeScript skeletone ju vynechá alebo premenuje, `plan-check` zlyhá s chybou `unmapped-spec-symbol`.
- **Výsledok:** Ani jedna požiadavka z EARS kontraktu nemôže vypadnúť medzi fázou špecifikácie požiadaviek a fázou plánovania.

### 2. Plan $\rightarrow$ Impl Brána (`diffHarnessGraphs` v `harness done` + `stale-doc-reference` v `harness gc --strict`)
Prechod z overeného plánu do hotovej implementácie je zapečatený dvoma mechanizmami:
- **`stale-doc-reference` v `harness gc --strict`:** Po nastavení `status: accepted` overí, že všetky súbory v `enforced_by` fyzicky existujú a všetky symboly v `spans`, `services` a `errors` majú aktívne náprotivky v `HarnessGraph`.
- **`diffHarnessGraphs` v `harness done`:** Porovná topologický graf plánu (`plan/current`) s grafom hotovej implementácie (`impl/current`). Implementácia nesmie vynechať žiadnu z naplánovaných funkcií, služieb či chybových vetiev.

---

## 6. Register existujúcich špecifikácií

| Identifikátor | Rozsah (Scope) | Názov | Status | Dátum |
| :--- | :--- | :--- | :--- | :--- |
| [sample:SPEC-0001](../../libs/sample/docs/specs/2026-10-25-sample-photo-gallery.md) | `sample` | Sample Photo Gallery and Durable Object Album Quota Counter | `accepted` | 2026-10-25 |
