# Architecture Decision Records (ADRs)

Tento priečinok a príslušné doménové priečinky obsahujú formálne **Architektonické Rozhodovacie Záznamy (Architecture Decision Records — ADR)** pre repozitár Effect-TS Engineering Harness.

Na rozdiel od bežnej statickej dokumentácie, ktorá rýchlo zastaráva a driftuje od reality, ADR v tomto harnessi predstavujú **živé, strojovo overiteľné zmluvy (machine-verifiable contracts)**, ktoré sú priamo prepojené s grafom kódu (`HarnessGraph`).

---

## 1. Konvencia ko-lokovaného monorepa (Co-Located Monorepo Convention)

Pre udržateľnosť veľkého monorepa uplatňujeme pravidlo ko-lokácie:

1. **Doménovo špecifické ADR:**
   - Ukladajú sa priamo do doménových balíkov: `libs/<scope>/docs/adr/NNNN-<slug>.md` (napr. `libs/harness/docs/adr/`, `libs/sample/docs/adr/`, `libs/es/docs/adr/`).
   - Používajú scoped identifikátor: `id: <scope>:ADR-NNNN` (napr. `harness:ADR-0001`, `sample:ADR-0001`).
2. **Koreňový priečinok `docs/adr/`:**
   - Je vyhradený výhradne pre prierezové, celo-monorepové rozhodnutia (cross-cutting workspace-wide decisions), ktoré sa nedajú priradiť jednému scope.
   - Slúži ako centrálny register a index pre celé monorepo.
3. **Automatické skenovanie v bránach:**
   - Nástroj `harness gc --strict` (`loadGovernanceDocsFromDisk`) automaticky rekurzívne skenuje `libs/*/docs/{adr,specs}`, `apps/*/docs/{adr,specs}` aj koreňové `docs/{adr,specs}`.

---

## 2. Formát ADR (MADR s typovo overiteľným frontmatterom)

Každý záznam využíva štandardizovaný formát MADR (Markdown Architecture Decision Records) obohatený o štruktúrovaný YAML frontmatter:

```yaml
---
id: <scope>:ADR-NNNN  # napr. harness:ADR-0001, sample:ADR-0001 (alebo ADR-NNNN pre globálne)
title: Stručný a výstižný názov architektonického rozhodnutia
status: proposed | accepted | superseded | deprecated
date: YYYY-MM-DD
enforced_by:
  - libs/harness/gates/src/stub.ts
  - tools/oxlint/syntax-bans.js
spans:
  - GraphGc.decide
  - SpanBudget.decide
services:
  - PhotoRepo
  - AlbumCounterClient
errors:
  - PhotoNotFoundError
---
```

### Povinné polia frontmatteru:
- **`id`**: Unikátny identifikátor v tvare `<scope>:ADR-NNNN` pre domény alebo `ADR-NNNN` pre globálne ADR (napr. `harness:ADR-0001`, `sample:ADR-0001`).
- **`title`**: Jednoriadkové zhrnutie prijatého rozhodnutia.
- **`status`**: Životný cyklus rozhodnutia (`proposed`, `accepted`, `superseded`, `deprecated`).
- **`date`**: Dátum prijatia vo formáte ISO (`YYYY-MM-DD`).
- **`enforced_by`**: Zoznam relatívnych ciest k súborom v repozitári, ktoré rozhodnutie vynucujú (napr. AST linter pravidlá, brány, testy, pattern recepty).
- **`spans`** *(voliteľné)*: Zoznam spanov `Effect.fn`, ktorých sa rozhodnutie priamo týka.
- **`services`** *(voliteľné)*: Zoznam servisných tagov (`Context.Service`), ktorých rozhrania alebo zmluvy rozhodnutie upravuje.
- **`errors`** *(voliteľné)*: Zoznam `TaggedError` tried spojených s rozhodnutím.

---

## 3. Kontrafaktuálne Pravidlo (Counterfactual Rule)

Inšpirované metodikou `ce-compound` a Nygard ADR štandardom:

> **Zaznamenajte ADR len vtedy, keď rozhodnutie zahŕňa neobvyklé obmedzenia, kompromisy alebo zamietnuté alternatívy, ktoré budúci inžinier alebo agent nemôže odvodiť zo samotného kódu.**

### Kontrafaktuálny test:
Pred zapísaním ADR si položte otázku:
> *"Zopakoval by budúci inžinier alebo autonómny agent rovnakú chybu, zvrátil by tento kompromis, alebo by znovu otvoril túto diskusiu, keby nemal k dispozícii kontext PREČO sme sa takto rozhodli?"*

- **Ak je odpoveď ÁNO:** Rozhodnutie patrí do `libs/<scope>/docs/adr/` (alebo `docs/adr/` pre globálne pravidlá) so zameraním na **Zamietnuté alternatívy (Rejected Alternatives)** a skryté obmedzenia.
- **Ak je odpoveď NIE:** Bežné implementačné detaily, štandardné Effect vzory a rutinné refaktoringy patria do `agent-patterns/*.md` alebo priamo do testov, nie do ADR.

---

## 4. Ochrana proti zastarávaniu: `stale-doc-reference` v `harness gc --strict`

Statická dokumentácia je často nebezpečnejšia než žiadna, pretože vytvára falošný pocit istoty. 

V našom harnessi spúšťa príkaz:
```bash
node --import ./tools/node-ts-resolver.mjs apps/harness-cli/src/index.ts gc --strict
```
čistú rozhodovaciu funkciu **`GraphGc.decide`**, ktorá automaticky vykonáva validáciu **`stale-doc-reference`**:

1. Pre každý súbor ADR so statusom `status: accepted` (v `libs/*/docs/adr/*.md`, `apps/*/docs/adr/*.md` aj `docs/adr/*.md`):
   - Overí, že každý súbor deklarovaný v poli **`enforced_by`** fyzicky existuje na disku.
   - Overí, že každý identifikátor v poli **`spans`** existuje ako aktívny `EffectFn` uzol v `HarnessGraph`.
   - Overí, že každý servis v poli **`services`** existuje ako `ServiceTag` v grafe.
   - Overí, že každá chyba v poli **`errors`** existuje ako `TaggedError` v grafe.
2. Ak je súbor zmazaný/premenovaný, alebo ak je span/servis/error v kóde odstránený bez aktualizácie príslušného ADR, `GraphGc.decide` zlyhá s chybou:
   ```json
   {
     "kind": "stale-doc-reference",
     "nodeId": "libs/harness/docs/adr/0001-deterministic-gates-and-plan-as-code.md",
     "message": "Referenced symbol 'OldSpan.decide' in libs/harness/docs/adr/0001-deterministic-gates-and-plan-as-code.md does not exist in workspace HarnessGraph."
   }
   ```
3. Zlyhanie zastaví prechod bránou `harness verify` a zablokuje `harness done`, čím garantuje 100% súlad medzi architektonickou dokumentáciou a skutočným kódom repozitára.

---

## 5. Integrácia do `HarnessGraph` & Omnigraph (MCP dopytovanie)

Každý ADR dokument je počas zostavovania grafu reprezentovaný ako plnohodnotný uzol v `HarnessGraph` a synchronizovaný do lokálneho analytického grafu Omnigraph:

- **Uzol `AdrDoc` (`_tag: "AdrDoc"`):**
  - Obsahuje metadáta: `id` (napr. `sample:ADR-0001`), `title`, `status`, `date`, relatívnu cestu k súboru `path` a zoznam vynucujúcich súborov `enforcedBy`.
- **Hrany `GovernsSymbol`:**
  - Z uzla `AdrDoc` smerujú hrany `GovernsSymbol` priamo na dotknuté uzly kódu:
    - `EffectFn` uzly (deklarované v poli `spans`),
    - `ServiceTag` uzly (deklarované v poli `services`),
    - `TaggedError` uzly (deklarované v poli `errors`).

### MCP dopytovanie pre autonómnych agentov

Autonómni agenti využívajú sadu MCP nástrojov (`apps/harness-mcp`) na obojsmernú navigáciu medzi kódom a architektonickými rozhodnutiami:

1. **Zistenie riadiacich ADR pre funkciu alebo službu (`harness_callers`):**
   Agent pred úpravou existujúcej služby alebo funkcie spustí dopyt na jej volajúcich:
   ```json
   // Nástroj: harness_callers({"qualname": "PhotoRepo"})
   {
     "callers": [
       {
         "qualname": "sample:ADR-0001",
         "nodeTag": "AdrDoc",
         "edgeKind": "GovernsSymbol",
         "file": "libs/sample/docs/adr/0001-cloudflare-d1-do-sqlite-and-traceparent-boundaries.md"
       }
     ]
   }
   ```
   Vďaka hrane `GovernsSymbol` agent okamžite vidí, že manipulácia s `PhotoRepo` podlieha rozhodnutiu `sample:ADR-0001`, a prečíta si zaznamenané architektonické obmedzenia a zamietnuté alternatívy skôr, než navrhne nekompatibilnú zmenu.

2. **Zistenie všetkých symbolov riadených daným ADR (`harness_callees`):**
   Pre zobrazenie všetkých funkcií, služieb a chýb podliehajúcich danému ADR:
   ```json
   // Nástroj: harness_callees({"qualname": "sample:ADR-0001"})
   {
     "callees": [
       { "qualname": "PhotoRepo", "nodeTag": "ServiceTag", "edgeKind": "GovernsSymbol" },
       { "qualname": "AlbumCounterClient", "nodeTag": "ServiceTag", "edgeKind": "GovernsSymbol" }
     ]
   }
   ```

3. **Detail uzla a metadáta ADR (`harness_resolve`):**
   ```json
   // Nástroj: harness_resolve({"qualname": "sample:ADR-0001"})
   ```
   Vráti kompletné metadáta uzla `AdrDoc`, vrátane cesty k súboru, statusu a väzieb na kód.

---

## 6. Register existujúcich ADR

| Identifikátor | Rozsah (Scope) | Názov | Status | Dátum |
| :--- | :--- | :--- | :--- | :--- |
| [harness:ADR-0001](../../libs/harness/docs/adr/0001-deterministic-gates-and-plan-as-code.md) | `harness` | Deterministic Gates and Compilable Plan-as-Code Skeletons Over Prose Plans | `accepted` | 2026-10-25 |
| [sample:ADR-0001](../../libs/sample/docs/adr/0001-cloudflare-d1-do-sqlite-and-traceparent-boundaries.md) | `sample` | Cloudflare D1 Read Projections, Durable Object Synchronous SQLite State, and W3C Traceparent Propagation | `accepted` | 2026-10-26 |
