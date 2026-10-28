import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import {
  AddCartItem,
  AddStock,
  CartEvent,
  CheckoutCart,
  CheckedOut,
  ConfirmReservation,
  InventoryEvent,
  ItemAdded,
  ReleaseReservation,
  RemoveCartItem,
  ReserveStock,
  StockAdded,
  StockReserved
} from "@harness/es-contract"
import { buildWorkspaceFnIndex, runWithTestTracer } from "@harness/ingest"
import {
  CartDecider,
  DeciderSpec,
  decideCart,
  decideInventory,
  evolveCart,
  evolveInventory,
  initialCartState,
  initialInventoryState,
  InventoryDecider
} from "../src/index.js"

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

const cartSpec = DeciderSpec.for(CartDecider)
const inventorySpec = DeciderSpec.for(InventoryDecider)

describe("CartDecider (given / when / then BDD & Property Tests)", () => {
  it.effect(
    "REQ-1.4 & REQ-2.1: WHEN AddCartItem is given on an empty cart, SHALL emit ItemAdded and accumulate quantities per SKU",
    () =>
      Effect.gen(function* () {
        const testId = "libs/es/domain/test/index.test.ts::cart-add-item"
        const repoRoot = resolveRepoRoot(process.cwd())
        const fnIndex = yield* buildWorkspaceFnIndex(repoRoot)

        const { result: first, edges } = yield* runWithTestTracer(
          testId,
          cartSpec
            .given([])
            .when(
              AddCartItem.make({
                commandId: "cmd-1",
                cartId: "cart-1",
                customerId: "cust-1",
                sku: "SKU-A",
                qty: 1
              })
            )
            .thenEvents([
              {
                _tag: "ItemAdded",
                version: 1,
                cartId: "cart-1",
                customerId: "cust-1",
                sku: "SKU-A",
                qty: 1
              }
            ]),
          fnIndex.bySpanName
        )

        expect(first.newState).toEqual({
          cartId: "cart-1",
          customerId: "cust-1",
          items: [{ sku: "SKU-A", qty: 1 }],
          checkedOut: false,
          checkedOutAt: null
        })

        const cartDecideQualname = fnIndex.bySpanName.get("Cart.decide")?.qualname
        expect(cartDecideQualname).toBeDefined()
        expect(
          edges.exercisesSpans.some((e) => e.calleeQualname === cartDecideQualname)
        ).toBe(true)

        // Adding a second distinct SKU and then incrementing the first SKU
        const secondEvents: ReadonlyArray<CartEvent> = [
          ...first.events,
          ItemAdded.make({
            version: 1,
            cartId: "cart-1",
            customerId: "cust-1",
            sku: "SKU-B",
            qty: 3
          })
        ]

        const second = yield* cartSpec
          .given(secondEvents)
          .when(
            AddCartItem.make({
              commandId: "cmd-2",
              cartId: "cart-1",
              customerId: "cust-1",
              sku: "SKU-A",
              qty: 2
            })
          )
          .thenEvents([
            {
              _tag: "ItemAdded",
              sku: "SKU-A",
              qty: 2
            }
          ])

        expect(second.newState.items).toEqual([
          { sku: "SKU-A", qty: 3 },
          { sku: "SKU-B", qty: 3 }
        ])
      })
  )

  it.effect(
    "REQ-2.2 & REQ-2.3: WHEN RemoveCartItem is given, SHALL clamp removed quantity, remove SKU at 0, and return no-op [] for absent SKU",
    () =>
      Effect.gen(function* () {
        const seeded: ReadonlyArray<CartEvent> = [
          ItemAdded.make({
            version: 1,
            cartId: "cart-1",
            customerId: "cust-1",
            sku: "SKU-A",
            qty: 3
          }),
          ItemAdded.make({
            version: 1,
            cartId: "cart-1",
            customerId: "cust-1",
            sku: "SKU-B",
            qty: 2
          })
        ]

        // Partial removal of SKU-A (3 - 1 = 2)
        const partial = yield* cartSpec
          .given(seeded)
          .when(
            RemoveCartItem.make({
              commandId: "cmd-rem-1",
              cartId: "cart-1",
              sku: "SKU-A",
              qty: 1
            })
          )
          .thenEvents([
            {
              _tag: "ItemRemoved",
              version: 1,
              cartId: "cart-1",
              sku: "SKU-A",
              qty: 1
            }
          ])
        expect(partial.newState.items).toEqual([
          { sku: "SKU-A", qty: 2 },
          { sku: "SKU-B", qty: 2 }
        ])

        // Exact removal of SKU-B (2 - 2 = 0 -> drops SKU-B, keeps SKU-A)
        const exactRemove = yield* cartSpec
          .given([...seeded, ...partial.events])
          .when(
            RemoveCartItem.make({
              commandId: "cmd-rem-2",
              cartId: "cart-1",
              sku: "SKU-B",
              qty: 2
            })
          )
          .thenEvents([
            {
              _tag: "ItemRemoved",
              sku: "SKU-B",
              qty: 2
            }
          ])
        expect(exactRemove.newState.items).toEqual([{ sku: "SKU-A", qty: 2 }])

        // Over-removal of SKU-A (request 5 when 2 remain -> clamps event qty to 2 and drops SKU-A)
        const clampedRemove = yield* cartSpec
          .given([...seeded, ...partial.events, ...exactRemove.events])
          .when(
            RemoveCartItem.make({
              commandId: "cmd-rem-3",
              cartId: "cart-1",
              sku: "SKU-A",
              qty: 5
            })
          )
          .thenEvents([
            {
              _tag: "ItemRemoved",
              sku: "SKU-A",
              qty: 2
            }
          ])
        expect(clampedRemove.newState.items).toEqual([])

        // Removing absent SKU is an idempotent no-op
        const noop = yield* cartSpec
          .given(seeded)
          .when(
            RemoveCartItem.make({
              commandId: "cmd-rem-absent",
              cartId: "cart-1",
              sku: "SKU-MISSING",
              qty: 1
            })
          )
          .thenNothing
        expect(noop.events).toEqual([])
      })
  )

  it.effect(
    "REQ-2.4, REQ-2.5, REQ-2.6, REQ-2.7: enforces Cart checkout and validation errors",
    () =>
      Effect.gen(function* () {
        // Empty cart checkout fails with EmptyCartCheckoutError
        const emptyErr = yield* cartSpec
          .given([])
          .when(
            CheckoutCart.make({
              commandId: "cmd-chk-empty",
              cartId: "cart-1",
              at: 1000
            })
          )
          .thenFails("EmptyCartCheckoutError", (err) => {
            expect(err.cartId).toBe("cart-1")
          })
        expect(emptyErr._tag).toBe("EmptyCartCheckoutError")

        // Invalid qty = 0 on AddCartItem and RemoveCartItem fails with InvalidQuantityError
        yield* cartSpec
          .given([])
          .when(
            AddCartItem.make({
              commandId: "cmd-invalid-add",
              cartId: "cart-1",
              customerId: "cust-1",
              sku: "SKU-A",
              qty: 0
            })
          )
          .thenFails("InvalidQuantityError", (err) => {
            expect(err.qty).toBe(0)
          })

        yield* cartSpec
          .given([])
          .when(
            RemoveCartItem.make({
              commandId: "cmd-invalid-rem",
              cartId: "cart-1",
              sku: "SKU-A",
              qty: 0
            })
          )
          .thenFails("InvalidQuantityError")

        // Non-empty cart checks out cleanly
        const checkedOutResult = yield* cartSpec
          .given([
            ItemAdded.make({
              version: 1,
              cartId: "cart-1",
              customerId: "cust-1",
              sku: "SKU-A",
              qty: 2
            })
          ])
          .when(
            CheckoutCart.make({
              commandId: "cmd-chk-ok",
              cartId: "cart-1",
              at: 1_730_000_000_000
            })
          )
          .thenEvents([
            {
              _tag: "CheckedOut",
              version: 1,
              cartId: "cart-1",
              at: 1_730_000_000_000
            }
          ])

        expect(checkedOutResult.newState.checkedOut).toBe(true)
        expect(checkedOutResult.newState.checkedOutAt).toBe(1_730_000_000_000)

        // Any command after checkout fails with CartAlreadyCheckedOutError
        yield* cartSpec
          .given([
            ItemAdded.make({
              version: 1,
              cartId: "cart-1",
              customerId: "cust-1",
              sku: "SKU-A",
              qty: 2
            }),
            CheckedOut.make({
              version: 1,
              cartId: "cart-1",
              at: 1_730_000_000_000
            })
          ])
          .when(
            AddCartItem.make({
              commandId: "cmd-after-chk",
              cartId: "cart-1",
              customerId: "cust-1",
              sku: "SKU-A",
              qty: 1
            })
          )
          .thenFails("CartAlreadyCheckedOutError", (err) => {
            expect(err.cartId).toBe("cart-1")
          })
      })
  )

  it.effect.prop(
    "REQ-1.3 & REQ-2.1..2.7: Cart.decide and CartDecider.fold satisfy state invariants across arbitrary inputs",
    {
      cartId: Schema.NonEmptyString,
      customerId: Schema.NonEmptyString,
      sku: Schema.NonEmptyString,
      qty: Schema.Int.check(Schema.isBetween({ minimum: -10, maximum: 50 })),
      checkedOut: Schema.Boolean,
      events: Schema.Array(CartEvent)
    },
    ({ cartId, checkedOut, customerId, events, qty, sku }) =>
      Effect.gen(function* () {
        // Deterministic replay invariant
        const foldedOnce = CartDecider.fold(events)
        const foldedTwice = events.reduce(evolveCart, initialCartState)
        expect(foldedOnce).toEqual(foldedTwice)

        const state = {
          ...initialCartState,
          cartId,
          customerId,
          checkedOut
        }
        const cmd = AddCartItem.make({
          commandId: "cmd-prop",
          cartId,
          customerId,
          sku,
          qty
        })

        const exit = yield* Effect.exit(decideCart(cmd, state))
        if (checkedOut) {
          expect(exit._tag).toBe("Failure")
        } else if (qty <= 0) {
          expect(exit._tag).toBe("Failure")
        } else {
          expect(exit._tag).toBe("Success")
          if (exit._tag === "Success") {
            expect(exit.value).toHaveLength(1)
            const nextState = CartDecider.fold(exit.value, state)
            expect(nextState.items[0]?.qty).toBe(qty)
          }
        }
      })
  )
})

describe("InventoryDecider (given / when / then BDD & Property Tests)", () => {
  it.effect(
    "REQ-3.1, REQ-3.2, REQ-3.3, REQ-3.7, REQ-3.9: handles AddStock and ReserveStock boundaries and idempotency",
    () =>
      Effect.gen(function* () {
        const testId = "libs/es/domain/test/index.test.ts::inventory-reserve"
        const repoRoot = resolveRepoRoot(process.cwd())
        const fnIndex = yield* buildWorkspaceFnIndex(repoRoot)

        // AddStock with qty = 0 fails with InvalidQuantityError
        const { edges } = yield* runWithTestTracer(
          testId,
          inventorySpec
            .given([])
            .when(
              AddStock.make({
                commandId: "cmd-add-0",
                sku: "SKU-1",
                qty: 0
              })
            )
            .thenFails("InvalidQuantityError"),
          fnIndex.bySpanName
        )

        const invDecideQualname = fnIndex.bySpanName.get("Inventory.decide")?.qualname
        expect(invDecideQualname).toBeDefined()
        expect(
          edges.exercisesSpans.some((e) => e.calleeQualname === invDecideQualname)
        ).toBe(true)

        // ReserveStock with qty = 0 fails with InvalidQuantityError
        yield* inventorySpec
          .given([])
          .when(
            ReserveStock.make({
              commandId: "cmd-res-0",
              sku: "SKU-1",
              reservationId: "res-1",
              cartId: "cart-1",
              qty: 0
            })
          )
          .thenFails("InvalidQuantityError")

        // AddStock with qty = 5 succeeds
        const added = yield* inventorySpec
          .given([])
          .when(
            AddStock.make({
              commandId: "cmd-add-5",
              sku: "SKU-1",
              qty: 5
            })
          )
          .thenEvents([
            {
              _tag: "StockAdded",
              version: 1,
              sku: "SKU-1",
              qty: 5
            }
          ])
        expect(added.newState.availableQty).toBe(5)

        // ReserveStock exceeding availableQty (6 > 5) fails with InsufficientStockError
        yield* inventorySpec
          .given(added.events)
          .when(
            ReserveStock.make({
              commandId: "cmd-res-too-much",
              sku: "SKU-1",
              reservationId: "res-over",
              cartId: "cart-1",
              qty: 6
            })
          )
          .thenFails("InsufficientStockError", (err) => {
            expect(err.availableQty).toBe(5)
            expect(err.requestedQty).toBe(6)
          })

        // ReserveStock with exact availableQty (5 === 5) succeeds and leaves availableQty = 0
        const exactReserve = yield* inventorySpec
          .given(added.events)
          .when(
            ReserveStock.make({
              commandId: "cmd-res-exact",
              sku: "SKU-1",
              reservationId: "res-1",
              cartId: "cart-1",
              qty: 5
            })
          )
          .thenEvents([
            {
              _tag: "StockReserved",
              version: 1,
              sku: "SKU-1",
              reservationId: "res-1",
              cartId: "cart-1",
              qty: 5
            }
          ])
        expect(exactReserve.newState.availableQty).toBe(0)
        expect(exactReserve.newState.reservations).toEqual([
          { reservationId: "res-1", cartId: "cart-1", qty: 5 }
        ])

        // Duplicate ReserveStock with same reservationId is an idempotent no-op []
        const duplicateReserve = yield* inventorySpec
          .given([...added.events, ...exactReserve.events])
          .when(
            ReserveStock.make({
              commandId: "cmd-res-dup",
              sku: "SKU-1",
              reservationId: "res-1",
              cartId: "cart-1",
              qty: 5
            })
          )
          .thenNothing
        expect(duplicateReserve.events).toEqual([])
      })
  )

  it.effect(
    "REQ-3.4, REQ-3.5, REQ-3.6, REQ-3.8: handles ConfirmReservation and ReleaseReservation",
    () =>
      Effect.gen(function* () {
        const history: ReadonlyArray<InventoryEvent> = [
          StockAdded.make({ version: 1, sku: "SKU-1", qty: 10 }),
          StockReserved.make({
            version: 1,
            sku: "SKU-1",
            reservationId: "res-1",
            cartId: "cart-1",
            qty: 4
          }),
          StockReserved.make({
            version: 1,
            sku: "SKU-1",
            reservationId: "res-2",
            cartId: "cart-2",
            qty: 3
          })
        ]

        // Confirming res-1 removes res-1 and keeps res-2
        const confirmed = yield* inventorySpec
          .given(history)
          .when(
            ConfirmReservation.make({
              commandId: "cmd-conf-1",
              sku: "SKU-1",
              reservationId: "res-1"
            })
          )
          .thenEvents([
            {
              _tag: "ReservationConfirmed",
              version: 1,
              sku: "SKU-1",
              reservationId: "res-1",
              qty: 4
            }
          ])
        expect(confirmed.newState.availableQty).toBe(3)
        expect(confirmed.newState.reservations).toEqual([
          { reservationId: "res-2", cartId: "cart-2", qty: 3 }
        ])

        // Confirming unknown reservation fails with ReservationNotFoundError
        yield* inventorySpec
          .given(history)
          .when(
            ConfirmReservation.make({
              commandId: "cmd-conf-missing",
              sku: "SKU-1",
              reservationId: "res-unknown"
            })
          )
          .thenFails("ReservationNotFoundError", (err) => {
            expect(err.reservationId).toBe("res-unknown")
          })

        // Releasing res-2 restores its 3 units to availableQty and keeps res-1
        const released = yield* inventorySpec
          .given(history)
          .when(
            ReleaseReservation.make({
              commandId: "cmd-rel-2",
              sku: "SKU-1",
              reservationId: "res-2"
            })
          )
          .thenEvents([
            {
              _tag: "ReservationReleased",
              version: 1,
              sku: "SKU-1",
              reservationId: "res-2",
              qty: 3
            }
          ])
        expect(released.newState.availableQty).toBe(6)
        expect(released.newState.reservations).toEqual([
          { reservationId: "res-1", cartId: "cart-1", qty: 4 }
        ])

        // Releasing already released / absent reservation is an idempotent no-op []
        const releaseNoop = yield* inventorySpec
          .given([...history, ...released.events])
          .when(
            ReleaseReservation.make({
              commandId: "cmd-rel-2-again",
              sku: "SKU-1",
              reservationId: "res-2"
            })
          )
          .thenNothing
        expect(releaseNoop.events).toEqual([])
      })
  )

  it.effect.prop(
    "REQ-3.1..3.9: Inventory.decide and InventoryDecider.fold satisfy stock invariants across arbitrary inputs",
    {
      sku: Schema.NonEmptyString,
      availableQty: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
      requestedQty: Schema.Int.check(Schema.isBetween({ minimum: -10, maximum: 120 })),
      events: Schema.Array(InventoryEvent)
    },
    ({ availableQty, events, requestedQty, sku }) =>
      Effect.gen(function* () {
        // Deterministic replay invariant
        const foldedOnce = InventoryDecider.fold(events)
        const foldedTwice = events.reduce(evolveInventory, initialInventoryState)
        expect(foldedOnce).toEqual(foldedTwice)

        const state = {
          sku,
          availableQty,
          reservations: []
        }
        const cmd = ReserveStock.make({
          commandId: "cmd-prop-res",
          sku,
          reservationId: "res-prop",
          cartId: "cart-prop",
          qty: requestedQty
        })

        const exit = yield* Effect.exit(decideInventory(cmd, state))
        if (requestedQty <= 0) {
          expect(exit._tag).toBe("Failure")
        } else if (requestedQty > availableQty) {
          expect(exit._tag).toBe("Failure")
        } else {
          expect(exit._tag).toBe("Success")
          if (exit._tag === "Success") {
            const nextState = InventoryDecider.fold(exit.value, state)
            expect(nextState.availableQty).toBe(availableQty - requestedQty)
            expect(nextState.reservations).toHaveLength(1)
          }
        }
      })
  )
})
