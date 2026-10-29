import { Cause, Effect, Equal, Exit } from "effect"
import { match } from "ts-pattern"
import type { Decider } from "./decider.js"

export type DeciderSpecAssertion<Event, Error> =
  | {
      readonly _tag: "thenEvents"
      readonly expectedEvents: ReadonlyArray<Event>
    }
  | {
      readonly _tag: "thenNothing"
    }
  | {
      readonly _tag: "thenFails"
      readonly expectedError?: Error | ((err: unknown) => boolean) | undefined
    }

export interface DeciderSpecBuilder<_State, Command, Event, Error> {
  readonly given: (...events: ReadonlyArray<Event>) => {
    readonly when: (command: Command) => {
      readonly thenEvents: (...expected: ReadonlyArray<Event>) => Effect.Effect<void, never, never>
      readonly thenNothing: () => Effect.Effect<void, never, never>
      readonly thenFails: (expectedError?: Error | ((err: unknown) => boolean)) => Effect.Effect<void, never, never>
    }
  }
}

export const test = Effect.fn("DeciderSpec.test")(function* <State, Command, Event, Error>(
  decider: Decider<State, Command, Event, Error>,
  givenEvents: ReadonlyArray<Event>,
  command: Command,
  assertion: DeciderSpecAssertion<Event, Error>
): Effect.fn.Return<void, never, never> {
  const initial =
    typeof decider.initialState === "function"
      ? (decider.initialState as () => State)()
      : decider.initialState

  let currentState = initial
  for (const event of givenEvents) {
    currentState = decider.evolve(currentState, event)
  }

  const exit = yield* Effect.exit(decider.decide(command, currentState))

  const assertionEffect: Effect.Effect<void, never, never> = match(assertion)
    .with({ _tag: "thenEvents" }, ({ expectedEvents }): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        if (!Exit.isSuccess(exit)) {
          return yield* Effect.die(
            new Error(
              `DeciderSpec expected success with ${expectedEvents.length} events, but decider failed: ${Cause.pretty(exit.cause)}`
            )
          )
        }
        const actualEvents = exit.value
        if (actualEvents.length !== expectedEvents.length) {
          return yield* Effect.die(
            new Error(
              `DeciderSpec event count mismatch: expected ${expectedEvents.length}, received ${actualEvents.length}. Received: ${JSON.stringify(actualEvents)}`
            )
          )
        }
        for (let i = 0; i < expectedEvents.length; i++) {
          const exp = expectedEvents[i]
          const act = actualEvents[i]
          if (!Equal.equals(exp, act) && JSON.stringify(exp) !== JSON.stringify(act)) {
            return yield* Effect.die(
              new Error(
                `DeciderSpec event mismatch at index ${i}:\nExpected: ${JSON.stringify(exp)}\nReceived: ${JSON.stringify(act)}`
              )
            )
          }
        }
      })
    )
    .with({ _tag: "thenNothing" }, (): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        if (!Exit.isSuccess(exit)) {
          return yield* Effect.die(
            new Error(
              `DeciderSpec expected nothing (0 events), but decider failed: ${Cause.pretty(exit.cause)}`
            )
          )
        }
        const actualEvents = exit.value
        if (actualEvents.length !== 0) {
          return yield* Effect.die(
            new Error(
              `DeciderSpec expected thenNothing (0 events), but received ${actualEvents.length} events: ${JSON.stringify(actualEvents)}`
            )
          )
        }
      })
    )
    .with({ _tag: "thenFails" }, ({ expectedError }): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        if (Exit.isSuccess(exit)) {
          return yield* Effect.die(
            new Error(
              `DeciderSpec expected decider to fail, but it succeeded with: ${JSON.stringify(exit.value)}`
            )
          )
        }
        const failureOpt = Cause.findErrorOption(exit.cause)
        const actualError: unknown = yield* match(failureOpt)
          .with({ _tag: "None" }, () =>
            Effect.die(
              new Error(
                `DeciderSpec expected typed failure, but received defect: ${Cause.pretty(exit.cause)}`
              )
            )
          )
          .with({ _tag: "Some" }, ({ value }) => Effect.succeed(value))
          .exhaustive()

        if (expectedError !== undefined) {
          if (typeof expectedError === "function") {
            const matches = (expectedError as (err: unknown) => boolean)(actualError)
            if (!matches) {
              return yield* Effect.die(
                new Error(
                  `DeciderSpec custom error predicate returned false for error: ${JSON.stringify(actualError)}`
                )
              )
            }
          } else {
            if (!Equal.equals(expectedError, actualError) && JSON.stringify(expectedError) !== JSON.stringify(actualError)) {
              return yield* Effect.die(
                new Error(
                  `DeciderSpec expected error ${JSON.stringify(expectedError)}, received ${JSON.stringify(actualError)}`
                )
              )
            }
          }
        }
      })
    )
    .exhaustive()

  return yield* assertionEffect
})

export const forDecider = <State, Command, Event, Error>(
  decider: Decider<State, Command, Event, Error>
): DeciderSpecBuilder<State, Command, Event, Error> => ({
  given: (...events: ReadonlyArray<Event>) => ({
    when: (command: Command) => ({
      thenEvents: (...expected: ReadonlyArray<Event>) =>
        test(decider, events, command, { _tag: "thenEvents", expectedEvents: expected }),
      thenNothing: () =>
        test(decider, events, command, { _tag: "thenNothing" }),
      thenFails: (expectedError?: Error | ((err: unknown) => boolean)) =>
        test(decider, events, command, { _tag: "thenFails", expectedError })
    })
  })
})
