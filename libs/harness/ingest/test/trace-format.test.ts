import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { makeTraceHeader, TraceHeader, TRACE_FORMAT_VERSION } from "../src/trace-format.js"

describe("trace format", () => {
  it("emits the v1 effect-span header with sampled:false", () => {
    expect(TRACE_FORMAT_VERSION).toBe(1)
    const header = makeTraceHeader("/repo")
    expect(header).toEqual({
      kind: "header",
      version: 1,
      language: "javascript",
      repo_root: "/repo",
      tracer: "effect-span",
      sampled: false
    })
  })

  it("decodes a produced header against its Schema", () => {
    const decoded = Schema.decodeUnknownSync(TraceHeader)(makeTraceHeader("/repo"))
    expect(decoded.tracer).toBe("effect-span")
  })
})
