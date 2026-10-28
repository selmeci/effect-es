import { describe, expect, it } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"
import {
  DeciderSpec,
  EventMetadata,
  makeCommandResultSchema,
  makeStoredEventSchema
} from "../src/index.js"
import {
  AddCartItem,
  CartDecider,
  CartEvent,
  CartState,
  CheckoutCart,
  CheckedOut,
  decideCart,
  evolveCart,
  initialCartState,
  ItemAdded,
  RemoveCartItem
} from "./fixtures/cart.js"
import {
  AddStock,
  ConfirmReservation,
  decideInventory,
  evolveInventory,
  initialInventoryState,
  InventoryDecider,
  InventoryEvent,
  InventoryState,
  ReleaseReservation,
  ReserveStock,
  StockAdded,
  StockReserved
} from "./fixtures/inventory.js"

const StoredCartEvent = makeStoredEventSchema(CartEvent)
const CartCommandResult = makeCommandResultSchema(CartState, CartEvent)
const InventoryCommandResult = makeCommandResultSchema(InventoryState, InventoryEvent)

const cartSpec = DeciderSpec.for(CartDecider)
const inventorySpec = DeciderSpec.for(InventoryDecider)

describe("es-contract core schemas", () => {
  it("REQ-1.1: validates EventMetadata and StoredEvent schemas", () => {
    const validMeta = {
      aggregateId: "cart-1",
      streamVersion: 1,
      commandId: "cmd-1",
      correlationId: "corr-1",
      causationId: "cmd-1",
      timestamp: 1_730_000_000_000
    }
    const decoded = Schema.decodeSync(EventMetadata)(validMeta)
    expect(decoded).toEqual(validMeta)

    const invalidMeta = Schema.decodeOption(EventMetadata)({
      ...validMeta,
      aggregateId: ""
    })
    expect(Option.isNone(invalidMeta)).toBe(true)

    const stored = Schema.decodeSync(StoredCartEvent)({
      event: {
        _tag: "ItemAdded",
        version: 1,
        cartId: "cart-1",
        customerId: "cust-1",
        sku: "SKU-1",
        qty: 2
      },
      metadata: validMeta
    })
    expect(stored.event._tag).toBe("ItemAdded")
    expect(stored.metadata.streamVersion).toBe(1)
  })

  it("validates makeCommandResultSchema factory", () => {
    const cartRes = Schema.decodeSync(CartCommandResult)({
      newState: {
        cartId: "cart-1",
        customerId: "cust-1",
        items: [{ sku: "SKU-1", qty: 2 }],
        checkedOut: false,
        checkedOutAt: null
      },
      appendedEvents: [
        {
          _tag: "ItemAdded",
          version: 1,
          cartId: "cart-1",
          customerId: "cust-1",
          sku: "SKU-1",
          qty: 2
        }
      ],
      nextExpectedStreamVersion: 1,
      created: true
    })
    expect(cartRes.created).toBe(true)

    const invRes = Schema.decodeSync(InventoryCommandResult)({
      newState: {
        sku: "SKU-1",
        availableQty: 10,
        reservations: []
      },
      appendedEvents: [
        {
          _tag: "StockAdded",
          version: 1,
          sku: "SKU-1",
          qty: 10
        }
      ],
      nextExpectedStreamVersion: 1,
      created: true
    })
    expect(invRes.nextExpectedStreamVersion).toBe(1)
  })
})

describe("DeciderSpec BDD DSL (exercised on Cart fixture)", () => {
  it.effect("WHEN command is given, SHALL emit events and evolve state via thenEvents", () =>
    Effect.gen(function* () {
      const first = yield* cartSpec
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
        ])

      expect(first.newState).toEqual({
        cartId: "cart-1",
        customerId: "cust-1",
        items: [{ sku: "SKU-A", qty: 1 }],
        checkedOut: false,
        checkedOutAt: null
      })

      // Incremental add with existing state
      const second = yield* cartSpec
        .given(first.events)
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

      expect(second.newState.items).toEqual([{ sku: "SKU-A", qty: 3 }])
    })
  )

  it.effect("WHEN command produces no change, SHALL assert no-op via thenNothing", () =>
    Effect.gen(function* () {
      const seeded: ReadonlyArray<CartEvent> = [
        ItemAdded.make({
          version: 1,
          cartId: "cart-1",
          customerId: "cust-1",
          sku: "SKU-A",
          qty: 3
        })
      ]

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
      expect(noop.newState.items).toEqual([{ sku: "SKU-A", qty: 3 }])
    })
  )

  it.effect("WHEN command violates domain invariants, SHALL assert failure via thenFails", () =>
    Effect.gen(function* () {
      // Empty checkout fails with EmptyCartCheckoutError
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

      // Invalid quantity fails with InvalidQuantityError
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

      // Already checked out fails with CartAlreadyCheckedOutError
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
        .thenFails("CartAlreadyCheckedOutError")
    })
  )

  it.effect.prop(
    "CartDecider.fold satisfies deterministic replay across arbitrary events",
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
        if (checkedOut || qty <= 0) {
          expect(exit._tag).toBe("Failure")
        } else {
          expect(exit._tag).toBe("Success")
          if (exit._tag === "Success") {
            const nextState = CartDecider.fold(exit.value, state)
            expect(nextState.items[0]?.qty).toBe(qty)
          }
        }
      })
  )
})

describe("DeciderSpec BDD DSL (exercised on Inventory fixture)", () => {
  it.effect("handles stock reservations and duplicate no-op idempotency", () =>
    Effect.gen(function* () {
      const added = yield* inventorySpec
        .given([])
        .when(AddStock.make({ commandId: "cmd-1", sku: "SKU-1", qty: 10 }))
        .thenEvents([{ _tag: "StockAdded", version: 1, sku: "SKU-1", qty: 10 }])

      expect(added.newState.availableQty).toBe(10)

      const reserved = yield* inventorySpec
        .given(added.events)
        .when(
          ReserveStock.make({
            commandId: "cmd-2",
            sku: "SKU-1",
            reservationId: "res-1",
            cartId: "cart-1",
            qty: 4
          })
        )
        .thenEvents([
          {
            _tag: "StockReserved",
            version: 1,
            sku: "SKU-1",
            reservationId: "res-1",
            cartId: "cart-1",
            qty: 4
          }
        ])

      expect(reserved.newState.availableQty).toBe(6)

      // Duplicate reservation with same reservationId is a no-op
      const dup = yield* inventorySpec
        .given([...added.events, ...reserved.events])
        .when(
          ReserveStock.make({
            commandId: "cmd-3",
            sku: "SKU-1",
            reservationId: "res-1",
            cartId: "cart-1",
            qty: 4
          })
        )
        .thenNothing

      expect(dup.events).toEqual([])
    })
  )

  it.effect("handles ConfirmReservation and ReleaseReservation lifecycle", () =>
    Effect.gen(function* () {
      const history: ReadonlyArray<InventoryEvent> = [
        StockAdded.make({ version: 1, sku: "SKU-1", qty: 10 }),
        StockReserved.make({
          version: 1,
          sku: "SKU-1",
          reservationId: "res-1",
          cartId: "cart-1",
          qty: 4
        })
      ]

      const released = yield* inventorySpec
        .given(history)
        .when(
          ReleaseReservation.make({
            commandId: "cmd-rel",
            sku: "SKU-1",
            reservationId: "res-1"
          })
        )
        .thenEvents([
          {
            _tag: "ReservationReleased",
            version: 1,
            sku: "SKU-1",
            reservationId: "res-1",
            qty: 4
          }
        ])

      expect(released.newState.availableQty).toBe(10)
      expect(released.newState.reservations).toEqual([])

      // Unknown confirm fails with ReservationNotFoundError
      yield* inventorySpec
        .given(history)
        .when(
          ConfirmReservation.make({
            commandId: "cmd-conf-bad",
            sku: "SKU-1",
            reservationId: "res-unknown"
          })
        )
        .thenFails("ReservationNotFoundError")
    })
  )

  it.effect.prop(
    "InventoryDecider.fold satisfies deterministic replay across arbitrary events",
    {
      sku: Schema.NonEmptyString,
      availableQty: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
      requestedQty: Schema.Int.check(Schema.isBetween({ minimum: -10, maximum: 120 })),
      events: Schema.Array(InventoryEvent)
    },
    ({ availableQty, events, requestedQty, sku }) =>
      Effect.gen(function* () {
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
        if (requestedQty <= 0 || requestedQty > availableQty) {
          expect(exit._tag).toBe("Failure")
        } else {
          expect(exit._tag).toBe("Success")
          if (exit._tag === "Success") {
            const nextState = InventoryDecider.fold(exit.value, state)
            expect(nextState.availableQty).toBe(availableQty - requestedQty)
          }
        }
      })
  )
})
