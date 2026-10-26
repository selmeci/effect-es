# Testing with Vitest and Effect Traces

Testing Effect applications utilizes @effect/vitest with it.effect and it.scoped alongside test Layers and test tracer spans from @harness/ingest.

## Testing with `@effect/vitest`

The `@effect/vitest` package provides native test runners that understand `Effect` generators, fiber lifecycles, and environment injection:

```ts
import { Effect, Layer } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { Greeter } from "service/greeter"

describe("Greeter Service", () => {
  it.effect("greets by name", () =>
    Effect.gen(function* () {
      const greeter = yield* Greeter
      const message = yield* greeter.greet("Alice")
      expect(message).toBe("Hello, Alice!")
    }).pipe(
      Effect.provide(Greeter.Test)
    )
  )

  it.scoped("tests resource lifecycle cleanly", () =>
    Effect.gen(function* () {
      const handle = yield* openTestResource
      expect(handle.isOpen).toBe(true)
    })
  )
})
```

## Mocking Dependencies with Test Layers

Create lightweight in-memory test layers using `Layer.succeed` or `Layer.effect`:

```ts
import { Layer } from "effect"
import { UserRepository } from "service/user-repository"

export const UserRepositoryTest = Layer.succeed(
  UserRepository,
  UserRepository.of({
    findById: (id) => Effect.succeed({ id, name: "Test User" }),
    save: (user) => Effect.succeed(user)
  })
)
```

## Recording Test Spans for Dual-Graph Indexing

The harness indexes runtime execution traces to map which tests exercise which domain functions. Use `runWithTestTracer` and `withRecordedTestSpan` from `@harness/ingest`:

```ts
import { Effect } from "effect"
import { describe, it, expect } from "@effect/vitest"
import { runWithTestTracer, withRecordedTestSpan } from "@harness/ingest"
import { calculateTotal } from "domain/cart"

describe("Cart Domain", () => {
  it.effect("calculates order total and records span", () =>
    runWithTestTracer("tests/cart.test.ts#calculates order total", () =>
      Effect.gen(function* () {
        const total = yield* withRecordedTestSpan("Cart.calculateTotal", () =>
          calculateTotal([{ price: 10, quantity: 2 }])
        )
        expect(total).toBe(20)
      })
    )
  )
})
```

The traces captured during test execution are serialized to `.harness/traces.ndjson` and ingested into the dual-layer property graph (`effect/Graph` + Omnigraph), producing `ExercisesSpan` and `TracedCall` edges.

## Deterministic Testing with `TestClock`

Control simulated time deterministically without real delays:

```ts
import { Duration, Effect, TestClock } from "effect"
import { it } from "@effect/vitest"

it.effect("advances simulated time", () =>
  Effect.gen(function* () {
    const fiber = yield* Effect.fork(delayedTask)
    yield* TestClock.adjust(Duration.seconds(10))
    const result = yield* Fiber.join(fiber)
    expect(result).toBe("done")
  })
)
```
