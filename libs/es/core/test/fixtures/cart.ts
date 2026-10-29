import { Effect, Schema } from "effect"
import { match, P } from "ts-pattern"
import type { Decider } from "../../src/decider.js"

export class CartAlreadyCheckedOutError extends Schema.TaggedError<CartAlreadyCheckedOutError>()(
  "CartAlreadyCheckedOutError",
  {
    cartId: Schema.String
  }
) {}

export class ItemAdded extends Schema.TaggedClass<ItemAdded>()("ItemAdded", {
  version: Schema.Literal(1),
  sku: Schema.String,
  qty: Schema.Natural
}) {}

export class CheckedOut extends Schema.TaggedClass<CheckedOut>()("CheckedOut", {
  version: Schema.Literal(1),
  at: Schema.Natural
}) {}

export const CartEvent = Schema.Union([ItemAdded, CheckedOut])
export type CartEvent = typeof CartEvent.Type

export class AddItem extends Schema.TaggedClass<AddItem>()("AddItem", {
  cartId: Schema.String,
  sku: Schema.String,
  qty: Schema.Natural
}) {}

export class Checkout extends Schema.TaggedClass<Checkout>()("Checkout", {
  cartId: Schema.String,
  at: Schema.Natural
}) {}

export const CartCommand = Schema.Union([AddItem, Checkout])
export type CartCommand = typeof CartCommand.Type

export const CartItem = Schema.Struct({
  sku: Schema.String,
  qty: Schema.Natural
})
export type CartItem = typeof CartItem.Type

export class CartOpen extends Schema.TaggedClass<CartOpen>()("Open", {
  cartId: Schema.String,
  items: Schema.Array(CartItem)
}) {}

export class CartCheckedOut extends Schema.TaggedClass<CartCheckedOut>()("CheckedOut", {
  cartId: Schema.String,
  items: Schema.Array(CartItem),
  at: Schema.Natural
}) {}

export const CartState = Schema.Union([CartOpen, CartCheckedOut])
export type CartState = typeof CartState.Type

export const initialCartState: CartState = new CartOpen({
  cartId: "cart-1",
  items: []
})

export const decideCart = Effect.fn("Cart.decide")(function* (
  command: CartCommand,
  state: CartState
): Effect.fn.Return<ReadonlyArray<CartEvent>, CartAlreadyCheckedOutError, never> {
  return yield* match([state, command] as const)
    .with([{ _tag: "CheckedOut" }, P._], ([s]) =>
      new CartAlreadyCheckedOutError({ cartId: s.cartId })
    )
    .with([{ _tag: "Open" }, { _tag: "AddItem", qty: 0 }], () =>
      Effect.succeed([] as ReadonlyArray<CartEvent>)
    )
    .with([{ _tag: "Open" }, { _tag: "AddItem" }], ([_openState, cmd]) =>
      Effect.succeed([
        new ItemAdded({
          version: 1,
          sku: cmd.sku,
          qty: cmd.qty
        })
      ] as ReadonlyArray<CartEvent>)
    )
    .with([{ _tag: "Open" }, { _tag: "Checkout" }], ([_openState, cmd]) =>
      Effect.succeed([
        new CheckedOut({
          version: 1,
          at: cmd.at
        })
      ] as ReadonlyArray<CartEvent>)
    )
    .exhaustive()
})

export const evolveCart = Effect.fn("Cart.evolve")(function* (
  state: CartState,
  event: CartEvent
): Effect.fn.Return<CartState, never, never> {
  const nextState: CartState = match([state, event] as const)
    .with([{ _tag: "Open" }, { _tag: "ItemAdded" }], ([s, evt]) => {
      // Consume version for dead-event-payload check
      const _version = evt.version
      const existing = s.items.find((item) => item.sku === evt.sku)
      const items =
        existing !== undefined
          ? s.items.map((item) =>
              item.sku === evt.sku
                ? { sku: item.sku, qty: item.qty + evt.qty }
                : item
            )
          : [...s.items, { sku: evt.sku, qty: evt.qty }]
      return new CartOpen({
        cartId: s.cartId,
        items
      })
    })
    .with([{ _tag: "Open" }, { _tag: "CheckedOut" }], ([s, evt]) => {
      const _version = evt.version
      return new CartCheckedOut({
        cartId: s.cartId,
        items: s.items,
        at: evt.at
      })
    })
    .with([{ _tag: "CheckedOut" }, P._], ([s]) => s)
    .exhaustive()

  return yield* Effect.succeed(nextState)
})

export const cartDecider: Decider<CartState, CartCommand, CartEvent, CartAlreadyCheckedOutError> = {
  initialState: initialCartState,
  evolve: (state, event) => Effect.runSync(evolveCart(state, event)),
  decide: (command, state) => decideCart(command, state)
}
