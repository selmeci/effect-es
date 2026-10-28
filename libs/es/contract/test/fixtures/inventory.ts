import { Effect, Schema } from "effect"
import { match } from "ts-pattern"
import { Decider } from "../../src/decider.js"

// ============================================================================
// Inventory Fixture Errors
// ============================================================================

export class InvalidQuantityError extends Schema.TaggedError<InvalidQuantityError>()(
  "InvalidQuantityError",
  {
    sku: Schema.String,
    qty: Schema.Int
  }
) {}

export class InsufficientStockError extends Schema.TaggedError<InsufficientStockError>()(
  "InsufficientStockError",
  {
    sku: Schema.String,
    requestedQty: Schema.Int,
    availableQty: Schema.Int
  }
) {}

export class ReservationNotFoundError extends Schema.TaggedError<ReservationNotFoundError>()(
  "ReservationNotFoundError",
  {
    sku: Schema.String,
    reservationId: Schema.String
  }
) {}

export class ReservationConflictError extends Schema.TaggedError<ReservationConflictError>()(
  "ReservationConflictError",
  {
    sku: Schema.String,
    reservationId: Schema.String,
    existingQty: Schema.Int,
    requestedQty: Schema.Int,
    existingCartId: Schema.String,
    requestedCartId: Schema.String
  }
) {}

// ============================================================================
// Inventory Fixture Schemas (State, Commands, Events)
// ============================================================================

export const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
export type PositiveInt = typeof PositiveInt.Type

export const StockReservation = Schema.Struct({
  reservationId: Schema.NonEmptyString,
  cartId: Schema.NonEmptyString,
  qty: PositiveInt
})

export type StockReservation = typeof StockReservation.Type

export const InventoryState = Schema.Struct({
  sku: Schema.String,
  availableQty: Schema.Int,
  reservations: Schema.Array(StockReservation)
})
export type InventoryState = typeof InventoryState.Type

export const AddStock = Schema.TaggedStruct("AddStock", {
  commandId: Schema.NonEmptyString,
  sku: Schema.NonEmptyString,
  qty: PositiveInt
})
export type AddStock = typeof AddStock.Type

export const ReserveStock = Schema.TaggedStruct("ReserveStock", {
  commandId: Schema.NonEmptyString,
  sku: Schema.NonEmptyString,
  reservationId: Schema.NonEmptyString,
  cartId: Schema.NonEmptyString,
  qty: PositiveInt
})
export type ReserveStock = typeof ReserveStock.Type

export const ConfirmReservation = Schema.TaggedStruct("ConfirmReservation", {
  commandId: Schema.NonEmptyString,
  sku: Schema.NonEmptyString,
  reservationId: Schema.NonEmptyString
})
export type ConfirmReservation = typeof ConfirmReservation.Type

export const ReleaseReservation = Schema.TaggedStruct("ReleaseReservation", {
  commandId: Schema.NonEmptyString,
  sku: Schema.NonEmptyString,
  reservationId: Schema.NonEmptyString
})
export type ReleaseReservation = typeof ReleaseReservation.Type

export const InventoryCommand = Schema.Union([
  AddStock,
  ReserveStock,
  ConfirmReservation,
  ReleaseReservation
])
export type InventoryCommand = typeof InventoryCommand.Type

export const StockAdded = Schema.TaggedStruct("StockAdded", {
  version: Schema.Literal(1),
  sku: Schema.NonEmptyString,
  qty: PositiveInt
})
export type StockAdded = typeof StockAdded.Type

export const StockReserved = Schema.TaggedStruct("StockReserved", {
  version: Schema.Literal(1),
  sku: Schema.NonEmptyString,
  reservationId: Schema.NonEmptyString,
  cartId: Schema.NonEmptyString,
  qty: PositiveInt
})
export type StockReserved = typeof StockReserved.Type

export const ReservationConfirmed = Schema.TaggedStruct("ReservationConfirmed", {
  version: Schema.Literal(1),
  sku: Schema.NonEmptyString,
  reservationId: Schema.NonEmptyString,
  qty: PositiveInt
})
export type ReservationConfirmed = typeof ReservationConfirmed.Type

export const ReservationReleased = Schema.TaggedStruct("ReservationReleased", {
  version: Schema.Literal(1),
  sku: Schema.NonEmptyString,
  reservationId: Schema.NonEmptyString,
  qty: PositiveInt
})
export type ReservationReleased = typeof ReservationReleased.Type

export const InventoryEvent = Schema.Union([
  StockAdded,
  StockReserved,
  ReservationConfirmed,
  ReservationReleased
])
export type InventoryEvent = typeof InventoryEvent.Type

// ============================================================================
// Inventory Decider Implementation (Test Fixture)
// ============================================================================

export const initialInventoryState: InventoryState = {
  sku: "",
  availableQty: 0,
  reservations: []
}

export const evolveInventory = (
  state: InventoryState,
  event: InventoryEvent
): InventoryState =>
  match(event)
    .with({ _tag: "StockAdded" }, (e) => ({
      ...state,
      sku: e.sku,
      availableQty: state.availableQty + e.qty
    }))
    .with({ _tag: "StockReserved" }, (e) => ({
      ...state,
      sku: e.sku,
      availableQty: state.availableQty - e.qty,
      reservations: [
        ...state.reservations,
        {
          reservationId: e.reservationId,
          cartId: e.cartId,
          qty: e.qty
        }
      ]
    }))
    .with({ _tag: "ReservationConfirmed" }, (e) => ({
      ...state,
      sku: e.sku,
      reservations: state.reservations.filter(
        (r) => r.reservationId !== e.reservationId
      )
    }))
    .with({ _tag: "ReservationReleased" }, (e) => ({
      ...state,
      sku: e.sku,
      availableQty: state.availableQty + e.qty,
      reservations: state.reservations.filter(
        (r) => r.reservationId !== e.reservationId
      )
    }))
    .exhaustive()

export const decideInventory = (
  command: InventoryCommand,
  state: InventoryState
): Effect.Effect<
  ReadonlyArray<InventoryEvent>,
  | InsufficientStockError
  | ReservationNotFoundError
  | ReservationConflictError
  | InvalidQuantityError,
  never
> =>
  match(command)
    .with({ _tag: "AddStock" }, (cmd) => {
      if (cmd.qty <= 0) {
        return new InvalidQuantityError({
          sku: cmd.sku,
          qty: cmd.qty
        })
      }
      return Effect.succeed([
        StockAdded.make({
          version: 1,
          sku: cmd.sku,
          qty: cmd.qty
        })
      ])
    })
    .with({ _tag: "ReserveStock" }, (cmd) => {
      if (cmd.qty <= 0) {
        return new InvalidQuantityError({
          sku: cmd.sku,
          qty: cmd.qty
        })
      }
      const existing = state.reservations.find(
        (r) => r.reservationId === cmd.reservationId
      )
      if (existing) {
        if (existing.qty === cmd.qty && existing.cartId === cmd.cartId) {
          return Effect.succeed([])
        }
        return new ReservationConflictError({
          sku: cmd.sku,
          reservationId: cmd.reservationId,
          existingQty: existing.qty,
          requestedQty: cmd.qty,
          existingCartId: existing.cartId,
          requestedCartId: cmd.cartId
        })
      }
      if (state.availableQty >= cmd.qty) {
        return Effect.succeed([
          StockReserved.make({
            version: 1,
            sku: cmd.sku,
            reservationId: cmd.reservationId,
            cartId: cmd.cartId,
            qty: cmd.qty
          })
        ])
      }
      return new InsufficientStockError({
        sku: cmd.sku,
        requestedQty: cmd.qty,
        availableQty: state.availableQty
      })
    })
    .with({ _tag: "ConfirmReservation" }, (cmd) => {
      const existing = state.reservations.find(
        (r) => r.reservationId === cmd.reservationId
      )
      if (!existing) {
        return new ReservationNotFoundError({
          sku: cmd.sku,
          reservationId: cmd.reservationId
        })
      }
      return Effect.succeed([
        ReservationConfirmed.make({
          version: 1,
          sku: cmd.sku,
          reservationId: cmd.reservationId,
          qty: existing.qty
        })
      ])
    })
    .with({ _tag: "ReleaseReservation" }, (cmd) => {
      const existing = state.reservations.find(
        (r) => r.reservationId === cmd.reservationId
      )
      if (!existing) {
        return Effect.succeed([])
      }
      return Effect.succeed([
        ReservationReleased.make({
          version: 1,
          sku: cmd.sku,
          reservationId: cmd.reservationId,
          qty: existing.qty
        })
      ])
    })
    .exhaustive()

export const InventoryDecider = Decider.make({
  initialState: initialInventoryState,
  evolve: evolveInventory,
  decide: decideInventory
})
