import { describe, expect, it } from "vitest"
import { IDIOM_BLOCKS } from "../src/idiom-router.js"

describe("IdiomRouterV1 data constraints", () => {
  it("puts review first (tie-break mitigation)", () => {
    expect(IDIOM_BLOCKS[0]).toBe("review")
  })

  it("stays within Ollama's 26-option limit", () => {
    expect(IDIOM_BLOCKS.length).toBeLessThanOrEqual(26)
    expect(IDIOM_BLOCKS.length).toBeGreaterThan(1)
  })
})
