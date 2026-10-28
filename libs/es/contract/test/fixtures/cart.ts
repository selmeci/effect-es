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

export const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
export type PositiveInt = typeof PositiveInt.Type

export const CartItem = Schema.Struct({
  sku: Schema.NonEmptyString,
  qty: PositiveInt
})
export type CartItem = typeof CartItem.Type

export const EmptyCartState = Schema.TaggedStruct("Empty", {
  cartId: Schema.String,
  customerId: Schema.String,
  items: Schema.Array(CartItem)
})
export type EmptyCartState = typeof EmptyCartState.Type

export const OpenCartState = Schema.TaggedStruct("Open", {
  cartId: Schema.String,
  customerId: Schema.String,
  items: Schema.NonEmptyArray(CartItem)
})
export type OpenCartState = typeof OpenCartState.Type

export const CheckedOutCartState = Schema.TaggedStruct("CheckedOut", {
  cartId: Schema.String,
  customerId: Schema.String,
  items: Schema.Array(CartItem),
  checkedOutAt: Schema.Int
})
export type CheckedOutCartState = typeof CheckedOutCartState.Type

export const CartState = Schema.Union([
  EmptyCartState,
  OpenCartState,
  CheckedOutCartState
])
export type CartState = typeof CartState.Type

export const AddCartItem = Schema.TaggedStruct("AddCartItem", {
  commandId: Schema.NonEmptyString,
  cartId: Schema.NonEmptyString,
  customerId: Schema.NonEmptyString,
  sku: Schema.NonEmptyString,
  qty: PositiveInt
})
export type AddCartItem = typeof AddCartItem.Type

export const RemoveCartItem = Schema.TaggedStruct("RemoveCartItem", {
  commandId: Schema.NonEmptyString,
  cartId: Schema.NonEmptyString,
  sku: Schema.NonEmptyString,
  qty: PositiveInt
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
  qty: PositiveInt
})
export type ItemAdded = typeof ItemAdded.Type

export const ItemRemoved = Schema.TaggedStruct("ItemRemoved", {
  version: Schema.Literal(1),
  cartId: Schema.NonEmptyString,
  sku: Schema.NonEmptyString,
  qty: PositiveInt
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
  _tag: "Empty",
  cartId: "",
  customerId: "",
  items: []
}

export const evolveCart = (state: CartState, event: CartEvent): CartState =>
  match(state)
    .with({ _tag: "CheckedOut" }, () => state)
    .with({ _tag: "Empty" }, () =>
      match(event)
        .with({ _tag: "ItemAdded" }, (e) => ({
          _tag: "Open" as const,
          cartId: e.cartId,
          customerId: e.customerId,
          items: [{ sku: e.sku, qty: e.qty }] as [CartItem, ...Array<CartItem>]
        }))
        .with({ _tag: "ItemRemoved" }, () => state)
        .with({ _tag: "CheckedOut" }, () => state)
        .exhaustive()
    )
    .with({ _tag: "Open" }, (openState) =>
      match(event)
        .with({ _tag: "ItemAdded" }, (e) => {
          const existing = openState.items.find((item) => item.sku === e.sku)
          const items = existing
            ? openState.items.map((item) =>
                item.sku === e.sku
                  ? { sku: item.sku, qty: (item.qty + e.qty) as PositiveInt }
                  : item
              )
            : [...openState.items, { sku: e.sku, qty: e.qty }]
          return {
            _tag: "Open" as const,
            cartId: e.cartId,
            customerId: e.customerId,
            items: items as [CartItem, ...Array<CartItem>]
          }
        })
        .with({ _tag: "ItemRemoved" }, (e) => {
          const items = openState.items.flatMap((item) => {
            if (item.sku !== e.sku) {
              return [item]
            }
            const remainingQty = item.qty - e.qty
            return remainingQty <= 0
              ? []
              : [{ sku: item.sku, qty: remainingQty as PositiveInt }]
          })
          if (items.length === 0) {
            return {
              _tag: "Empty" as const,
              cartId: e.cartId,
              customerId: openState.customerId,
              items: []
            }
          }
          return {
            _tag: "Open" as const,
            cartId: e.cartId,
            customerId: openState.customerId,
            items: items as [CartItem, ...Array<CartItem>]
          }
        })
        .with({ _tag: "CheckedOut" }, (e) => ({
          _tag: "CheckedOut" as const,
          cartId: e.cartId,
          customerId: openState.customerId,
          items: openState.items,
          checkedOutAt: e.at
        }))
        .exhaustive()
    )
    .exhaustive()

export const decideCart = (
  command: CartCommand,
  state: CartState
): Effect.Effect<
  ReadonlyArray<CartEvent>,
  CartAlreadyCheckedOutError | EmptyCartCheckoutError | InvalidQuantityError,
  never
> =>
  match(state)
    .with({ _tag: "CheckedOut" }, () =>
      new CartAlreadyCheckedOutError({ cartId: command.cartId })
    )
    .with({ _tag: "Empty" }, () =>
      match(command)
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
          return Effect.succeed([])
        })
        .with({ _tag: "CheckoutCart" }, (cmd) =>
          new EmptyCartCheckoutError({ cartId: cmd.cartId })
        )
        .exhaustive()
    )
    .with({ _tag: "Open" }, (openState) =>
      match(command)
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
          const existing = openState.items.find((item) => item.sku === cmd.sku)
          if (!existing) {
            return Effect.succeed([])
          }
          if (cmd.qty > existing.qty) {
            return new InvalidQuantityError({
              sku: cmd.sku,
              qty: cmd.qty
            })
          }
          return Effect.succeed([
            ItemRemoved.make({
              version: 1,
              cartId: cmd.cartId,
              sku: cmd.sku,
              qty: cmd.qty
            })
          ])
        })
        .with({ _tag: "CheckoutCart" }, (cmd) =>
          Effect.succeed([
            CheckedOut.make({
              version: 1,
              cartId: cmd.cartId,
              at: cmd.at
            })
          ])
        )
        .exhaustive()
    )
    .exhaustive()

export const CartDecider = Decider.make({
  initialState: initialCartState,
  evolve: evolveCart,
  decide: decideCart
})
