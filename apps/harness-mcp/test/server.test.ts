import { describe, expect, it } from "vitest"
import { createServer } from "../src/server.js"

describe("harness-mcp", () => {
  it("constructs an MCP server without registering tools yet", () => {
    expect(createServer()).toBeDefined()
  })
})
