import { describe, expect, it } from "@effect/vitest"
import { Option, Schema } from "effect"
import {
  CartCommand,
  CartCommandResult,
  CartEvent,
  CartState,
  EventMetadata,
  InventoryCommand,
  InventoryCommandResult,
  InventoryEvent,
  makeStoredEventSchema
} from "../src/index.js"

const StoredCartEvent = makeStoredEventSchema(CartEvent)

describe("es-contract schemas", () => {
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

  it("validates CartCommandResult and InventoryCommandResult schemas", () => {
    const cartRes = Schema.decodeSync(CartCommandResult)({
      newState: {
        cartId: "cart-1",
        customerId: "cust-1",
        items: [{ sku: "SKU-1", qty: 2 }],
        checkedOut: false,
        checkedOutAt: null
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
      nextExpectedStreamVersion: 1,
      created: true
    })
    expect(cartRes.created).toBe(true)

    const invRes = Schema.decodeSync(InventoryCommandResult)({
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
      nextExpectedStreamVersion: 1,
      created: true
    })
    expect(invRes.nextExpectedStreamVersion).toBe(1)
  })

  it.prop(
    "REQ-1.2: cleanly round-trips arbitrary CartEvent values with version 1",
    { event: CartEvent },
    ({ event }) => {
      expect(event.version).toBe(1)
      const encoded = Schema.encodeSync(CartEvent)(event)
      const decoded = Schema.decodeSync(CartEvent)(encoded)
      expect(decoded).toEqual(event)
    }
  )

  it.prop(
    "REQ-1.2: cleanly round-trips arbitrary InventoryEvent values with version 1",
    { event: InventoryEvent },
    ({ event }) => {
      expect(event.version).toBe(1)
      const encoded = Schema.encodeSync(InventoryEvent)(event)
      const decoded = Schema.decodeSync(InventoryEvent)(encoded)
      expect(decoded).toEqual(event)
    }
  )

  it.prop(
    "cleanly round-trips arbitrary CartCommand and CartState values",
    { command: CartCommand, state: CartState },
    ({ command, state }) => {
      const decodedCmd = Schema.decodeSync(CartCommand)(
        Schema.encodeSync(CartCommand)(command)
      )
      const decodedState = Schema.decodeSync(CartState)(
        Schema.encodeSync(CartState)(state)
      )
      expect(decodedCmd).toEqual(command)
      expect(decodedState).toEqual(state)
    }
  )

  it.prop(
    "cleanly round-trips arbitrary InventoryCommand values",
    { command: InventoryCommand },
    ({ command }) => {
      const decodedCmd = Schema.decodeSync(InventoryCommand)(
        Schema.encodeSync(InventoryCommand)(command)
      )
      expect(decodedCmd).toEqual(command)
    }
  )
})
