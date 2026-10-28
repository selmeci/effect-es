import { Schema } from "effect"

export * from "./decider.js"

// ============================================================================
// Core Event Sourcing Contracts (effect-es)
// ============================================================================

export const EventMetadata = Schema.Struct({
  aggregateId: Schema.NonEmptyString,
  streamVersion: Schema.Int,
  commandId: Schema.NonEmptyString,
  correlationId: Schema.NonEmptyString,
  causationId: Schema.NonEmptyString,
  timestamp: Schema.Int
})
export type EventMetadata = typeof EventMetadata.Type

export const makeStoredEventSchema = <S extends Schema.Top>(eventSchema: S) =>
  Schema.Struct({
    event: eventSchema,
    metadata: EventMetadata
  })

export const makeCommandResultSchema = <
  StateSchema extends Schema.Top,
  EventSchema extends Schema.Top
>(
  stateSchema: StateSchema,
  eventSchema: EventSchema
) =>
  Schema.Struct({
    newState: stateSchema,
    appendedEvents: Schema.Array(eventSchema),
    nextExpectedStreamVersion: Schema.Int,
    created: Schema.Boolean
  })

export interface CommandResult<State, Event> {
  readonly newState: State
  readonly appendedEvents: ReadonlyArray<Event>
  readonly nextExpectedStreamVersion: number
  readonly created: boolean
}

// ============================================================================
// Shared & Aggregate Tagged Errors
// ============================================================================

export class InvalidQuantityError extends Schema.TaggedError<InvalidQuantityError>()(
  "InvalidQuantityError",
  {
    sku: Schema.String,
    qty: Schema.Int
  }
) {}

export class CartAlreadyCheckedOutError extends Schema.TaggedError<CartAlreadyCheckedOutError>()(
  "CartAlreadyCheckedOutError",
  {
    cartId: Schema.String
  }
) {}

export class EmptyCartCheckoutError extends Schema.TaggedError<EmptyCartCheckoutError>()(
  "EmptyCartCheckoutError",
  {
    cartId: Schema.String
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
// Cart Aggregate Schemas (State, Commands, Events)
// ============================================================================

export const CartItem = Schema.Struct({
  sku: Schema.NonEmptyString,
  qty: Schema.Int
})
export type CartItem = typeof CartItem.Type

export const CartState = Schema.Struct({
  cartId: Schema.String,
  customerId: Schema.String,
  items: Schema.Array(CartItem),
  checkedOut: Schema.Boolean,
  checkedOutAt: Schema.NullOr(Schema.Int)
})
export type CartState = typeof CartState.Type

export const AddCartItem = Schema.TaggedStruct("AddCartItem", {
  commandId: Schema.NonEmptyString,
  cartId: Schema.NonEmptyString,
  customerId: Schema.NonEmptyString,
  sku: Schema.NonEmptyString,
  qty: Schema.Int
})
export type AddCartItem = typeof AddCartItem.Type

export const RemoveCartItem = Schema.TaggedStruct("RemoveCartItem", {
  commandId: Schema.NonEmptyString,
  cartId: Schema.NonEmptyString,
  sku: Schema.NonEmptyString,
  qty: Schema.Int
})
export type RemoveCartItem = typeof RemoveCartItem.Type

export const CheckoutCart = Schema.TaggedStruct("CheckoutCart", {
  commandId: Schema.NonEmptyString,
  cartId: Schema.NonEmptyString,
  at: Schema.Int
})
export type CheckoutCart = typeof CheckoutCart.Type

export const CartCommand = Schema.Union([
  AddCartItem,
  RemoveCartItem,
  CheckoutCart
])
export type CartCommand = typeof CartCommand.Type

export const ItemAdded = Schema.TaggedStruct("ItemAdded", {
  version: Schema.Literal(1),
  cartId: Schema.NonEmptyString,
  customerId: Schema.NonEmptyString,
  sku: Schema.NonEmptyString,
  qty: Schema.Int
})
export type ItemAdded = typeof ItemAdded.Type

export const ItemRemoved = Schema.TaggedStruct("ItemRemoved", {
  version: Schema.Literal(1),
  cartId: Schema.NonEmptyString,
  sku: Schema.NonEmptyString,
  qty: Schema.Int
})
export type ItemRemoved = typeof ItemRemoved.Type

export const CheckedOut = Schema.TaggedStruct("CheckedOut", {
  version: Schema.Literal(1),
  cartId: Schema.NonEmptyString,
  at: Schema.Int
})
export type CheckedOut = typeof CheckedOut.Type

export const CartEvent = Schema.Union([
  ItemAdded,
  ItemRemoved,
  CheckedOut
])
export type CartEvent = typeof CartEvent.Type

export const CartCommandResult = makeCommandResultSchema(CartState, CartEvent)
export type CartCommandResult = typeof CartCommandResult.Type

// ============================================================================
// Inventory Aggregate Schemas (State, Commands, Events)
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

export const InventoryCommandResult = makeCommandResultSchema(InventoryState, InventoryEvent)
export type InventoryCommandResult = typeof InventoryCommandResult.Type
