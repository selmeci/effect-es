import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import * as Decider from "../src/decider.js"
import {
  AddItem,
  cartDecider,
  CartOpen,
  CheckedOut,
  decideCart,
  evolveCart,
  initialCartState,
  ItemAdded
} from "./fixtures/cart.js"

describe("Decider Property Invariants", () => {
  it.effect.prop(
    "REQ-1.6 & REQ-3.3: evolve is total and replay is deterministic across arbitrary event sequences",
    {
      qty1: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
      qty2: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
      sku: Schema.NonEmptyString
    },
    ({ qty1, qty2, sku }) =>
      Effect.gen(function* () {
        const events = [
          new ItemAdded({ version: 1, sku, qty: qty1 }),
          new ItemAdded({ version: 1, sku, qty: qty2 })
        ]

        // 1. Batch replay via Decider.evolve
        const batchState = yield* Decider.evolve(cartDecider, initialCartState, events)

        // 2. Incremental replay step-by-step using evolveCart
        let incrementalState = initialCartState
        for (const evt of events) {
          incrementalState = yield* evolveCart(incrementalState, evt)
        }

        expect(batchState).toEqual(incrementalState)
        expect(batchState).toEqual(
          new CartOpen({
            cartId: "cart-1",
            items: [{ sku, qty: qty1 + qty2 }]
          })
        )
      })
  )

  it.effect.prop(
    "REQ-3.1 & REQ-3.2: decideCart emits ItemAdded for open cart and rejects checked out cart",
    {
      qty: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 500 })),
      sku: Schema.NonEmptyString
    },
    ({ qty, sku }) =>
      Effect.gen(function* () {
        const cmd = new AddItem({ cartId: "cart-1", sku, qty })

        // 1. Open cart decision
        const openResult = yield* decideCart(cmd, initialCartState)
        if (qty === 0) {
          expect(openResult).toHaveLength(0)
        } else {
          expect(openResult).toEqual([
            new ItemAdded({ version: 1, sku, qty })
          ])
        }

        // 2. Checked out cart decision
        const checkedOutState = yield* evolveCart(
          initialCartState,
          new CheckedOut({ version: 1, at: 100 })
        )
        const error = yield* Effect.flip(decideCart(cmd, checkedOutState))
        expect(error._tag).toBe("CartAlreadyCheckedOutError")
      })
  )
})
