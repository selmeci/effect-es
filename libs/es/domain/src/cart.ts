import { Effect } from "effect"
import {
  CartAlreadyCheckedOutError,
  type CartCommand,
  type CartEvent,
  type CartState,
  CheckedOut,
  Decider,
  EmptyCartCheckoutError,
  InvalidQuantityError,
  ItemAdded,
  ItemRemoved
} from "@harness/es-contract"

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

export const decideCart = Effect.fn("Cart.decide")(function* (
  command: CartCommand,
  state: CartState
): Effect.fn.Return<
  ReadonlyArray<CartEvent>,
  CartAlreadyCheckedOutError | EmptyCartCheckoutError | InvalidQuantityError
> {
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
