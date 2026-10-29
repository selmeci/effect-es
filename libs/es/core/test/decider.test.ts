import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { buildWorkspaceFnIndex, runWithTestTracer } from "@harness/ingest"
import * as Decider from "../src/decider.js"
import { forDecider } from "../src/testing.js"
import {
  AddItem,
  CartAlreadyCheckedOutError,
  cartDecider,
  CartOpen,
  Checkout,
  decideCart,
  evolveCart,
  initialCartState,
  ItemAdded,
  CheckedOut
} from "./fixtures/cart.js"

const resolveRepoRoot = (startDir: string): string => {
  let curr = path.resolve(startDir)
  while (curr !== path.dirname(curr)) {
    if (fs.existsSync(path.join(curr, "pnpm-workspace.yaml"))) {
      return curr
    }
    curr = path.dirname(curr)
  }
  return startDir
}

describe("Decider Core & DeciderSpec", () => {
  it.effect("REQ-1.1: Decider.make creates a typed decider instance", () =>
    Effect.gen(function* () {
      const repoRoot = resolveRepoRoot(process.cwd())
      const fnIndex = yield* buildWorkspaceFnIndex(repoRoot)
      const testId = "libs/es/core/test/decider.test.ts::Decider.make creates decider"

      const { result } = yield* runWithTestTracer(
        testId,
        Decider.make({
          initialState: initialCartState,
          evolve: cartDecider.evolve,
          decide: cartDecider.decide
        }),
        fnIndex.bySpanName
      )

      expect(result.initialState).toEqual(initialCartState)
      expect(typeof result.evolve).toBe("function")
      expect(typeof result.decide).toBe("function")
    })
  )

  it.effect("REQ-1.3 & REQ-3.1: Decider.decide evaluates command and returns new events", () =>
    Effect.gen(function* () {
      const repoRoot = resolveRepoRoot(process.cwd())
      const fnIndex = yield* buildWorkspaceFnIndex(repoRoot)
      const testId = "libs/es/core/test/decider.test.ts::Decider.decide returns new events"

      const cmd = new AddItem({ cartId: "cart-1", sku: "SKU-A", qty: 2 })
      const { result } = yield* runWithTestTracer(
        testId,
        decideCart(cmd, initialCartState),
        fnIndex.bySpanName
      )

      expect(result).toHaveLength(1)
      const first = result[0]
      expect(first).toBeDefined()
      if (first !== undefined) {
        expect(first._tag).toBe("ItemAdded")
        expect((first as ItemAdded).sku).toBe("SKU-A")
        expect((first as ItemAdded).qty).toBe(2)
      }
    })
  )

  it.effect("REQ-1.4 & REQ-2.2: Decider.decide returns empty array for no-op commands", () =>
    Effect.gen(function* () {
      const repoRoot = resolveRepoRoot(process.cwd())
      const fnIndex = yield* buildWorkspaceFnIndex(repoRoot)
      const testId = "libs/es/core/test/decider.test.ts::Decider.decide returns empty array for no-op"

      const cmd = new AddItem({ cartId: "cart-1", sku: "SKU-A", qty: 0 })
      const { result } = yield* runWithTestTracer(
        testId,
        Decider.decide(cartDecider, initialCartState, cmd),
        fnIndex.bySpanName
      )

      expect(result).toHaveLength(0)

      yield* forDecider(cartDecider)
        .given()
        .when(cmd)
        .thenNothing()
    })
  )

  it.effect("REQ-1.5 & REQ-3.2: Decider.decide fails with typed domain error when rejected", () =>
    Effect.gen(function* () {
      const repoRoot = resolveRepoRoot(process.cwd())
      const fnIndex = yield* buildWorkspaceFnIndex(repoRoot)
      const testId = "libs/es/core/test/decider.test.ts::Decider.decide fails with domain error"

      const checkedOutState = yield* Decider.evolve(cartDecider, initialCartState, [
        new CheckedOut({ version: 1, at: 1000 })
      ])

      const cmd = new AddItem({ cartId: "cart-1", sku: "SKU-B", qty: 1 })
      const err = yield* Effect.flip(
        runWithTestTracer(
          testId,
          Decider.decide(cartDecider, checkedOutState, cmd),
          fnIndex.bySpanName
        ).pipe(Effect.map((r) => r.result))
      )

      expect(err._tag).toBe("CartAlreadyCheckedOutError")
      expect((err as CartAlreadyCheckedOutError).cartId).toBe("cart-1")
    })
  )

  it.effect("REQ-2.1: DeciderSpec verifies given-when-thenEvents BDD workflow", () =>
    Effect.gen(function* () {
      const repoRoot = resolveRepoRoot(process.cwd())
      const fnIndex = yield* buildWorkspaceFnIndex(repoRoot)
      const testId = "libs/es/core/test/decider.test.ts::DeciderSpec given when thenEvents"

      yield* runWithTestTracer(
        testId,
        forDecider(cartDecider)
          .given(new ItemAdded({ version: 1, sku: "SKU-1", qty: 1 }))
          .when(new AddItem({ cartId: "cart-1", sku: "SKU-2", qty: 3 }))
          .thenEvents(new ItemAdded({ version: 1, sku: "SKU-2", qty: 3 })),
        fnIndex.bySpanName
      )

      yield* forDecider(cartDecider)
        .given(new ItemAdded({ version: 1, sku: "SKU-1", qty: 1 }))
        .when(new Checkout({ cartId: "cart-1", at: 1000 }))
        .thenEvents(new CheckedOut({ version: 1, at: 1000 }))
    })
  )

  it.effect("REQ-2.3: DeciderSpec verifies thenFails when command is rejected", () =>
    Effect.gen(function* () {
      const repoRoot = resolveRepoRoot(process.cwd())
      const fnIndex = yield* buildWorkspaceFnIndex(repoRoot)
      const testId = "libs/es/core/test/decider.test.ts::DeciderSpec thenFails"

      yield* runWithTestTracer(
        testId,
        forDecider(cartDecider)
          .given(new CheckedOut({ version: 1, at: 500 }))
          .when(new AddItem({ cartId: "cart-1", sku: "SKU-FAIL", qty: 1 }))
          .thenFails(new CartAlreadyCheckedOutError({ cartId: "cart-1" })),
        fnIndex.bySpanName
      )
    })
  )

  it.effect("REQ-1.6: Decider.evolve folds sequence of events deterministically", () =>
    Effect.gen(function* () {
      const repoRoot = resolveRepoRoot(process.cwd())
      const fnIndex = yield* buildWorkspaceFnIndex(repoRoot)
      const testId = "libs/es/core/test/decider.test.ts::Decider.evolve folds events"

      const events = [
        new ItemAdded({ version: 1, sku: "SKU-1", qty: 2 }),
        new ItemAdded({ version: 1, sku: "SKU-1", qty: 3 }),
        new ItemAdded({ version: 1, sku: "SKU-2", qty: 1 })
      ]

      const { result } = yield* runWithTestTracer(
        testId,
        Decider.evolve(cartDecider, initialCartState, events),
        fnIndex.bySpanName
      )

      const singleEvolved = yield* evolveCart(
        initialCartState,
        new ItemAdded({ version: 1, sku: "SKU-TEST", qty: 4 })
      )
      expect(singleEvolved._tag).toBe("Open")

      expect(result._tag).toBe("Open")
      const open = result as CartOpen
      expect(open.items).toHaveLength(2)
      expect(open.items.find((i) => i.sku === "SKU-1")?.qty).toBe(5)
      expect(open.items.find((i) => i.sku === "SKU-2")?.qty).toBe(1)
    })
  )
})
