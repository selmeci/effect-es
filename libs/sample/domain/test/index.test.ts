import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { greet } from "../src/index.js"

describe("greet", () => {
  it.effect("greets by name", () =>
    Effect.gen(function* () {
      const out = yield* greet({ name: "Roman" })
      expect(out).toBe("Hello, Roman!")
    })
  )
})
