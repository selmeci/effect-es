import { Effect, Schema } from "effect"
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

// ============================================================================
// Inventory Fixture Schemas (State, Commands, Events)
// ============================================================================

export const StockReservation = Schema.Struct({
  reservationId: Schema.NonEmptyString,
  cartId: Schema.NonEmptyString,
  qty: Schema.Int
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
  qty: Schema.Int
})
export type AddStock = typeof AddStock.Type

export const ReserveStock = Schema.TaggedStruct("ReserveStock", {
  commandId: Schema.NonEmptyString,
  sku: Schema.NonEmptyString,
  reservationId: Schema.NonEmptyString,
  cartId: Schema.NonEmptyString,
  qty: Schema.Int
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
  qty: Schema.Int
})
export type StockAdded = typeof StockAdded.Type

export const StockReserved = Schema.TaggedStruct("StockReserved", {
  version: Schema.Literal(1),
  sku: Schema.NonEmptyString,
  reservationId: Schema.NonEmptyString,
  cartId: Schema.NonEmptyString,
  qty: Schema.Int
})
export type StockReserved = typeof StockReserved.Type

export const ReservationConfirmed = Schema.TaggedStruct("ReservationConfirmed", {
  version: Schema.Literal(1),
  sku: Schema.NonEmptyString,
  reservationId: Schema.NonEmptyString,
  qty: Schema.Int
})
export type ReservationConfirmed = typeof ReservationConfirmed.Type

export const ReservationReleased = Schema.TaggedStruct("ReservationReleased", {
  version: Schema.Literal(1),
  sku: Schema.NonEmptyString,
  reservationId: Schema.NonEmptyString,
  qty: Schema.Int
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
): InventoryState => {
  switch (event._tag) {
    case "StockAdded": {
      return {
        ...state,
        sku: event.sku,
        availableQty: state.availableQty + event.qty
      }
    }
    case "StockReserved": {
      return {
        ...state,
        sku: event.sku,
        availableQty: state.availableQty - event.qty,
        reservations: [
          ...state.reservations,
          {
            reservationId: event.reservationId,
            cartId: event.cartId,
            qty: event.qty
          }
        ]
      }
    }
    case "ReservationConfirmed": {
      return {
        ...state,
        sku: event.sku,
        reservations: state.reservations.filter(
          (r) => r.reservationId !== event.reservationId
        )
      }
    }
    case "ReservationReleased": {
      return {
        ...state,
        sku: event.sku,
        availableQty: state.availableQty + event.qty,
        reservations: state.reservations.filter(
          (r) => r.reservationId !== event.reservationId
        )
      }
    }
  }
}

export const decideInventory = (
  command: InventoryCommand,
  state: InventoryState
): Effect.Effect<
  ReadonlyArray<InventoryEvent>,
  InsufficientStockError | ReservationNotFoundError | InvalidQuantityError,
  never
> =>
  Effect.gen(function* () {
    switch (command._tag) {
      case "AddStock": {
        if (command.qty <= 0) {
          return yield* new InvalidQuantityError({
            sku: command.sku,
            qty: command.qty
          })
        }
        return [
          StockAdded.make({
            version: 1,
            sku: command.sku,
            qty: command.qty
          })
        ]
      }
      case "ReserveStock": {
        if (command.qty <= 0) {
          return yield* new InvalidQuantityError({
            sku: command.sku,
            qty: command.qty
          })
        }
        const alreadyReserved = state.reservations.some(
          (r) => r.reservationId === command.reservationId
        )
        if (alreadyReserved) {
          return []
        }
        if (state.availableQty >= command.qty) {
          return [
            StockReserved.make({
              version: 1,
              sku: command.sku,
              reservationId: command.reservationId,
              cartId: command.cartId,
              qty: command.qty
            })
          ]
        }
        return yield* new InsufficientStockError({
          sku: command.sku,
          requestedQty: command.qty,
          availableQty: state.availableQty
        })
      }
      case "ConfirmReservation": {
        const existing = state.reservations.find(
          (r) => r.reservationId === command.reservationId
        )
        if (!existing) {
          return yield* new ReservationNotFoundError({
            sku: command.sku,
            reservationId: command.reservationId
          })
        }
        return [
          ReservationConfirmed.make({
            version: 1,
            sku: command.sku,
            reservationId: command.reservationId,
            qty: existing.qty
          })
        ]
      }
      case "ReleaseReservation": {
        const existing = state.reservations.find(
          (r) => r.reservationId === command.reservationId
        )
        if (!existing) {
          return []
        }
        return [
          ReservationReleased.make({
            version: 1,
            sku: command.sku,
            reservationId: command.reservationId,
            qty: existing.qty
          })
        ]
      }
    }
  })

export const InventoryDecider = Decider.make({
  initialState: initialInventoryState,
  evolve: evolveInventory,
  decide: decideInventory
})
