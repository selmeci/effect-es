import { Effect, Schema } from "effect"
import { Decider } from "../../src/decider.js"

// ============================================================================
// Cart Fixture Errors
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

// ============================================================================
// Cart Fixture Schemas (State, Commands, Events)
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

// ============================================================================
// Cart Decider Implementation (Test Fixture)
// ============================================================================

export const initialCartState: CartState = {
  cartId: "",
  customerId: "",
  items: [],
  checkedOut: false,
  checkedOutAt: null
}

export const evolveCart = (state: CartState, event: CartEvent): CartState => {
  switch (event._tag) {
    case "ItemAdded": {
      const existing = state.items.find((item) => item.sku === event.sku)
      const items = existing
        ? state.items.map((item) =>
            item.sku === event.sku
              ? { sku: item.sku, qty: item.qty + event.qty }
              : item
          )
        : [...state.items, { sku: event.sku, qty: event.qty }]
      return {
        ...state,
        cartId: event.cartId,
        customerId: event.customerId,
        items
      }
    }
    case "ItemRemoved": {
      const items = state.items.flatMap((item) => {
        if (item.sku !== event.sku) {
          return [item]
        }
        const remainingQty = item.qty - event.qty
        return remainingQty <= 0 ? [] : [{ sku: item.sku, qty: remainingQty }]
      })
      return {
        ...state,
        cartId: event.cartId,
        items
      }
    }
    case "CheckedOut": {
      return {
        ...state,
        cartId: event.cartId,
        checkedOut: true,
        checkedOutAt: event.at
      }
    }
  }
}

export const decideCart = (
  command: CartCommand,
  state: CartState
): Effect.Effect<
  ReadonlyArray<CartEvent>,
  CartAlreadyCheckedOutError | EmptyCartCheckoutError | InvalidQuantityError,
  never
> =>
  Effect.gen(function* () {
    if (state.checkedOut) {
      return yield* new CartAlreadyCheckedOutError({ cartId: command.cartId })
    }

    switch (command._tag) {
      case "AddCartItem": {
        if (command.qty <= 0) {
          return yield* new InvalidQuantityError({
            sku: command.sku,
            qty: command.qty
          })
        }
        return [
          ItemAdded.make({
            version: 1,
            cartId: command.cartId,
            customerId: command.customerId,
            sku: command.sku,
            qty: command.qty
          })
        ]
      }
      case "RemoveCartItem": {
        if (command.qty <= 0) {
          return yield* new InvalidQuantityError({
            sku: command.sku,
            qty: command.qty
          })
        }
        const existing = state.items.find((item) => item.sku === command.sku)
        if (!existing) {
          return []
        }
        const removedQty = Math.min(command.qty, existing.qty)
        return [
          ItemRemoved.make({
            version: 1,
            cartId: command.cartId,
            sku: command.sku,
            qty: removedQty
          })
        ]
      }
      case "CheckoutCart": {
        if (state.items.length === 0) {
          return yield* new EmptyCartCheckoutError({ cartId: command.cartId })
        }
        return [
          CheckedOut.make({
            version: 1,
            cartId: command.cartId,
            at: command.at
          })
        ]
      }
    }
  })

export const CartDecider = Decider.make({
  initialState: initialCartState,
  evolve: evolveCart,
  decide: decideCart
})
