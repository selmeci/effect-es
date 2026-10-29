import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import {
  CommandMetadata,
  EventMetadata
} from "../src/index.js"

describe("effect-es contract", () => {
  it("decodes EventMetadata schema correctly", () => {
    const meta = Schema.decodeSync(EventMetadata)({
      aggregateId: "agg-123",
      streamVersion: 1,
      commandId: "cmd-456",
      timestamp: 1700000000
    })
    expect(meta.aggregateId).toBe("agg-123")
    expect(meta.streamVersion).toBe(1)
    expect(meta.commandId).toBe("cmd-456")
  })

  it("decodes CommandMetadata schema correctly", () => {
    const meta = Schema.decodeSync(CommandMetadata)({
      commandId: "cmd-789",
      aggregateId: "agg-123",
      timestamp: 1700000000
    })
    expect(meta.commandId).toBe("cmd-789")
    expect(meta.aggregateId).toBe("agg-123")
  })
})
