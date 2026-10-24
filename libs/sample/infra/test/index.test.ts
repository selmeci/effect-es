import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { logToConsole } from "../src/index.js"

describe("logToConsole", () => {
  it.effect("runs without failing", () =>
    Effect.gen(function* () {
      yield* logToConsole("harness")
      expect(true).toBe(true)
    })
  )
})
