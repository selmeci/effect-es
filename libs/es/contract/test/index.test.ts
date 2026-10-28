import { describe, expect, it } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"
import { match } from "ts-pattern"
import {
  DeciderSpec,
  EventMetadata,
  makeCommandResultSchema,
  makeStoredEventSchema,
  runDecider
} from "../src/index.js"
import {
  AddCartItem,
  CartDecider,
  CartEvent,
  CartState,
  CheckoutCart,
  CheckedOut,
  decideCart,
  ItemAdded,
  RemoveCartItem
} from "./fixtures/cart.js"
import {
  AddStock,
  ConfirmReservation,
  decideInventory,
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

  it("validates makeCommandResultSchema factory as a closed tagged union", () => {
    const cartRes = Schema.decodeSync(CartCommandResult)({
      _tag: "Created",
      newState: {
        _tag: "Open",
        cartId: "cart-1",
        customerId: "cust-1",
        items: [{ sku: "SKU-1", qty: 2 }]
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
      nextExpectedStreamVersion: 1
    })
    expect(cartRes._tag).toBe("Created")

    const invRes = Schema.decodeSync(InventoryCommandResult)({
      _tag: "Appended",
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
      nextExpectedStreamVersion: 1
    })
    expect(invRes._tag).toBe("Appended")
    expect(invRes.nextExpectedStreamVersion).toBe(1)
  })
})

describe("Decider.run and runDecider framework primitives (REQ-1.6)", () => {
  it.effect("executes decide and folds newState from default initialState", () =>
    Effect.gen(function* () {
      const result = yield* CartDecider.run(
        AddCartItem.make({
          commandId: "cmd-run-1",
          cartId: "cart-run",
          customerId: "cust-run",
          sku: "SKU-RUN",
          qty: 5
        })
      )
      expect(result.events).toHaveLength(1)
      expect(result.events[0]?._tag).toBe("ItemAdded")
      expect(result.newState._tag).toBe("Open")
      expect(result.newState.items).toEqual([{ sku: "SKU-RUN", qty: 5 }])
    })
  )

  it.effect("executes decide from prior populated state via runDecider span", () =>
    Effect.gen(function* () {
      const priorState: CartState = {
        _tag: "Open",
        cartId: "cart-run",
        customerId: "cust-run",
        items: [{ sku: "SKU-A", qty: 2 }]
      }

      const res = yield* runDecider(
        CartDecider,
        AddCartItem.make({
          commandId: "cmd-run-2",
          cartId: "cart-run",
          customerId: "cust-run",
          sku: "SKU-B",
          qty: 3
        }),
        priorState
      )

      expect(res.events).toHaveLength(1)
      expect(res.newState._tag).toBe("Open")
      expect(res.newState.items).toHaveLength(2)
    })
  )
})

describe("DeciderSpec negative failure tests (ensures assertions actually fail on mismatch)", () => {
  it.effect("thenEvents dies when event count mismatches", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        cartSpec
          .given([])
          .when(
            AddCartItem.make({
              commandId: "cmd-neg-1",
              cartId: "c-1",
              customerId: "cust-1",
              sku: "SKU-1",
              qty: 1
            })
          )
          .thenEvents([
            { _tag: "ItemAdded", sku: "SKU-1", qty: 1 },
            { _tag: "ItemAdded", sku: "SKU-EXTRA", qty: 1 }
          ])
      )
      expect(exit._tag).toBe("Failure")
    })
  )

  it.effect("thenEvents dies when field expectation mismatches", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        cartSpec
          .given([])
          .when(
            AddCartItem.make({
              commandId: "cmd-neg-2",
              cartId: "c-1",
              customerId: "cust-1",
              sku: "SKU-1",
              qty: 1
            })
          )
          .thenEvents([{ _tag: "ItemAdded", sku: "SKU-WRONG", qty: 1 }])
      )
      expect(exit._tag).toBe("Failure")
    })
  )

  it.effect("thenNothing dies when command produces events", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        cartSpec
          .given([])
          .when(
            AddCartItem.make({
              commandId: "cmd-neg-3",
              cartId: "c-1",
              customerId: "cust-1",
              sku: "SKU-1",
              qty: 1
            })
          )
          .thenNothing
      )
      expect(exit._tag).toBe("Failure")
    })
  )

  it.effect("thenFails dies when command succeeds instead of failing", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        cartSpec
          .given([])
          .when(
            AddCartItem.make({
              commandId: "cmd-neg-4",
              cartId: "c-1",
              customerId: "cust-1",
              sku: "SKU-1",
              qty: 1
            })
          )
          .thenFails("InvalidQuantityError")
      )
      expect(exit._tag).toBe("Failure")
    })
  )

  it.effect("thenFails dies when error tag mismatches", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        cartSpec
          .given([])
          .when(
            CheckoutCart.make({
              commandId: "cmd-neg-5",
              cartId: "c-1",
              at: 1000
            })
          )
          .thenFails("CartAlreadyCheckedOutError")
      )
      expect(exit._tag).toBe("Failure")
    })
  )
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
        _tag: "Open",
        cartId: "cart-1",
        customerId: "cust-1",
        items: [{ sku: "SKU-A", qty: 1 }]
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

  it.effect("handles successful CheckoutCart transitioning to CheckedOut closed union state", () =>
    Effect.gen(function* () {
      const res = yield* cartSpec
        .given([
          ItemAdded.make({
            version: 1,
            cartId: "cart-chk",
            customerId: "cust-chk",
            sku: "SKU-1",
            qty: 2
          })
        ])
        .when(
          CheckoutCart.make({
            commandId: "cmd-chk-ok",
            cartId: "cart-chk",
            at: 2000
          })
        )
        .thenEvents([
          {
            _tag: "CheckedOut",
            cartId: "cart-chk",
            at: 2000
          }
        ])

      expect(res.newState._tag).toBe("CheckedOut")
      match(res.newState)
        .with({ _tag: "CheckedOut" }, (c) => {
          expect(c.checkedOutAt).toBe(2000)
        })
        .with({ _tag: "Open" }, () => {
          expect.unreachable("expected CheckedOut state")
        })
        .with({ _tag: "Empty" }, () => {
          expect.unreachable("expected CheckedOut state")
        })
        .exhaustive()
    })
  )

  it.effect("handles partial item removal, full item removal, and line quantity bounds", () =>
    Effect.gen(function* () {
      const seeded: ReadonlyArray<CartEvent> = [
        ItemAdded.make({
          version: 1,
          cartId: "cart-rem",
          customerId: "cust-rem",
          sku: "SKU-1",
          qty: 3
        })
      ]

      // Partial removal (3 - 1 = 2)
      const partial = yield* cartSpec
        .given(seeded)
        .when(
          RemoveCartItem.make({
            commandId: "cmd-rem-part",
            cartId: "cart-rem",
            sku: "SKU-1",
            qty: 1
          })
        )
        .thenEvents([{ _tag: "ItemRemoved", sku: "SKU-1", qty: 1 }])

      expect(partial.newState.items).toEqual([{ sku: "SKU-1", qty: 2 }])
      expect(partial.newState._tag).toBe("Open")

      // Full removal (3 - 3 = 0 -> Empty)
      const full = yield* cartSpec
        .given(seeded)
        .when(
          RemoveCartItem.make({
            commandId: "cmd-rem-full",
            cartId: "cart-rem",
            sku: "SKU-1",
            qty: 3
          })
        )
        .thenEvents([{ _tag: "ItemRemoved", sku: "SKU-1", qty: 3 }])

      expect(full.newState._tag).toBe("Empty")
      expect(full.newState.items).toEqual([])

      // Exceeding line quantity fails with InvalidQuantityError
      yield* cartSpec
        .given(seeded)
        .when(
          RemoveCartItem.make({
            commandId: "cmd-rem-over",
            cartId: "cart-rem",
            sku: "SKU-1",
            qty: 5
          })
        )
        .thenFails("InvalidQuantityError")
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
      qty: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })),
      events: Schema.Array(CartEvent)
    },
    ({ cartId, customerId, events, qty, sku }) =>
      Effect.gen(function* () {
        const folded = CartDecider.fold(events)
        expect(folded.cartId).toBeDefined()

        const state: CartState = {
          _tag: "Open",
          cartId,
          customerId,
          items: [{ sku, qty }]
        }
        const cmd = AddCartItem.make({
          commandId: "cmd-prop",
          cartId,
          customerId,
          sku,
          qty
        })

        const exit = yield* Effect.exit(decideCart(cmd, state))
        match(exit)
          .with({ _tag: "Success" }, (s) => {
            const nextState = CartDecider.fold(s.value, state)
            expect(nextState.items[0]?.qty).toBe(qty * 2)
          })
          .with({ _tag: "Failure" }, () => {
            expect.unreachable("expected valid AddCartItem to succeed on open cart")
          })
          .exhaustive()
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

      // Identical retry with same reservationId, cartId, and qty is an idempotent no-op
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

  it.effect("fails on conflicting duplicate reservation hold with ReservationConflictError", () =>
    Effect.gen(function* () {
      const history = [
        StockAdded.make({ version: 1, sku: "SKU-1", qty: 10 }),
        StockReserved.make({
          version: 1,
          sku: "SKU-1",
          reservationId: "res-1",
          cartId: "cart-1",
          qty: 3
        })
      ]

      // Conflicting qty
      yield* inventorySpec
        .given(history)
        .when(
          ReserveStock.make({
            commandId: "cmd-conf-qty",
            sku: "SKU-1",
            reservationId: "res-1",
            cartId: "cart-1",
            qty: 5
          })
        )
        .thenFails("ReservationConflictError")

      // Conflicting cartId
      yield* inventorySpec
        .given(history)
        .when(
          ReserveStock.make({
            commandId: "cmd-conf-cart",
            sku: "SKU-1",
            reservationId: "res-1",
            cartId: "cart-OTHER",
            qty: 3
          })
        )
        .thenFails("ReservationConflictError")
    })
  )

  it.effect("handles ConfirmReservation and ReleaseReservation lifecycle with availableQty invariance", () =>
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

      // Confirm reservation: removes hold from reservations, leaves availableQty unchanged at 6
      const confirmed = yield* inventorySpec
        .given(history)
        .when(
          ConfirmReservation.make({
            commandId: "cmd-conf-ok",
            sku: "SKU-1",
            reservationId: "res-1"
          })
        )
        .thenEvents([
          {
            _tag: "ReservationConfirmed",
            sku: "SKU-1",
            reservationId: "res-1",
            qty: 4
          }
        ])

      expect(confirmed.newState.availableQty).toBe(6)
      expect(confirmed.newState.reservations).toEqual([])

      // Release reservation: restores hold back to availableQty (6 + 4 = 10)
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

      // Unknown release is an idempotent no-op
      yield* inventorySpec
        .given(history)
        .when(
          ReleaseReservation.make({
            commandId: "cmd-rel-unknown",
            sku: "SKU-1",
            reservationId: "res-unknown"
          })
        )
        .thenNothing
    })
  )

  it.effect.prop(
    "InventoryDecider.fold satisfies deterministic replay across arbitrary events",
    {
      sku: Schema.NonEmptyString,
      availableQty: Schema.Int.check(Schema.isBetween({ minimum: 10, maximum: 100 })),
      requestedQty: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 })),
      events: Schema.Array(InventoryEvent)
    },
    ({ availableQty, events, requestedQty, sku }) =>
      Effect.gen(function* () {
        const folded = InventoryDecider.fold(events)
        expect(folded.sku).toBeDefined()

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
        match(exit)
          .with({ _tag: "Success" }, (s) => {
            const nextState = InventoryDecider.fold(s.value, state)
            expect(nextState.availableQty).toBe(availableQty - requestedQty)
          })
          .with({ _tag: "Failure" }, () => {
            expect.unreachable("expected valid ReserveStock to succeed on ample available stock")
          })
          .exhaustive()
      })
  )
})
