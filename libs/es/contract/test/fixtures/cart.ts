import { Effect, Schema } from "effect"
import { match } from "ts-pattern"
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

export const evolveCart = (state: CartState, event: CartEvent): CartState =>
  match(event)
    .with({ _tag: "ItemAdded" }, (e) => {
      const existing = state.items.find((item) => item.sku === e.sku)
      const items = existing
        ? state.items.map((item) =>
            item.sku === e.sku
              ? { sku: item.sku, qty: item.qty + e.qty }
              : item
          )
        : [...state.items, { sku: e.sku, qty: e.qty }]
      return {
        ...state,
        cartId: e.cartId,
        customerId: e.customerId,
        items
      }
    })
    .with({ _tag: "ItemRemoved" }, (e) => {
      const items = state.items.flatMap((item) => {
        if (item.sku !== e.sku) {
          return [item]
        }
        const remainingQty = item.qty - e.qty
        return remainingQty <= 0 ? [] : [{ sku: item.sku, qty: remainingQty }]
      })
      return {
        ...state,
        cartId: e.cartId,
        items
      }
    })
    .with({ _tag: "CheckedOut" }, (e) => ({
      ...state,
      cartId: e.cartId,
      checkedOut: true,
      checkedOutAt: e.at
    }))
    .exhaustive()

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

    return yield* match(command)
      .with({ _tag: "AddCartItem" }, (cmd) => {
        if (cmd.qty <= 0) {
          return new InvalidQuantityError({
            sku: cmd.sku,
            qty: cmd.qty
          })
        }
        return Effect.succeed([
          ItemAdded.make({
            version: 1,
            cartId: cmd.cartId,
            customerId: cmd.customerId,
            sku: cmd.sku,
            qty: cmd.qty
          })
        ])
      })
      .with({ _tag: "RemoveCartItem" }, (cmd) => {
        if (cmd.qty <= 0) {
          return new InvalidQuantityError({
            sku: cmd.sku,
            qty: cmd.qty
          })
        }
        const existing = state.items.find((item) => item.sku === cmd.sku)
        if (!existing) {
          return Effect.succeed([])
        }
        const removedQty = Math.min(cmd.qty, existing.qty)
        return Effect.succeed([
          ItemRemoved.make({
            version: 1,
            cartId: cmd.cartId,
            sku: cmd.sku,
            qty: removedQty
          })
        ])
      })
      .with({ _tag: "CheckoutCart" }, (cmd) => {
        if (state.items.length === 0) {
          return new EmptyCartCheckoutError({ cartId: cmd.cartId })
        }
        return Effect.succeed([
          CheckedOut.make({
            version: 1,
            cartId: cmd.cartId,
            at: cmd.at
          })
        ])
      })
      .exhaustive()
  })

export const CartDecider = Decider.make({
  initialState: initialCartState,
  evolve: evolveCart,
  decide: decideCart
})
