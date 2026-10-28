import { Effect } from "effect"
import {
  Decider,
  InsufficientStockError,
  type InventoryCommand,
  type InventoryEvent,
  type InventoryState,
  InvalidQuantityError,
  ReservationConfirmed,
  ReservationNotFoundError,
  ReservationReleased,
  StockAdded,
  StockReserved
} from "@harness/es-contract"

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

export const decideInventory = Effect.fn("Inventory.decide")(function* (
  command: InventoryCommand,
  state: InventoryState
): Effect.fn.Return<
  ReadonlyArray<InventoryEvent>,
  InsufficientStockError | ReservationNotFoundError | InvalidQuantityError
> {
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
