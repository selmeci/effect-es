import { Effect } from "effect"

export interface DeciderDefinition<State, Command, Event, Error> {
  readonly initialState: State
  readonly evolve: (state: State, event: Event) => State
  readonly decide: (
    command: Command,
    state: State
  ) => Effect.Effect<ReadonlyArray<Event>, Error, never>
}

export interface Decider<State, Command, Event, Error>
  extends DeciderDefinition<State, Command, Event, Error> {
  readonly fold: (events: Iterable<Event>, initial?: State) => State
  readonly run: (
    command: Command,
    state?: State
  ) => Effect.Effect<
    { readonly events: ReadonlyArray<Event>; readonly newState: State },
    Error,
    never
  >
}

export const runDecider = Effect.fn("Decider.run")(function* <
  State,
  Command,
  Event,
  Error
>(
  decider: DeciderDefinition<State, Command, Event, Error>,
  command: Command,
  state: State
): Effect.fn.Return<
  { readonly events: ReadonlyArray<Event>; readonly newState: State },
  Error
> {
  const events = yield* decider.decide(command, state)
  let current = state
  for (const event of events) {
    current = decider.evolve(current, event)
  }
  return { events, newState: current }
})

export const Decider = {
  make: <State, Command, Event, Error>(
    definition: DeciderDefinition<State, Command, Event, Error>
  ): Decider<State, Command, Event, Error> => {
    const fold = (
      events: Iterable<Event>,
      initial: State = definition.initialState
    ): State => {
      let current = initial
      for (const event of events) {
        current = definition.evolve(current, event)
      }
      return current
    }

    const run = (
      command: Command,
      state: State = definition.initialState
    ): Effect.Effect<
      { readonly events: ReadonlyArray<Event>; readonly newState: State },
      Error,
      never
    > => runDecider(definition, command, state)

    return {
      ...definition,
      fold,
      run
    }
  },
  run: runDecider
} as const

export interface DeciderSpecWhen<State, Event, Error extends { readonly _tag: string }> {
  readonly thenEvents: (
    expected:
      | ReadonlyArray<Partial<Event>>
      | ((events: ReadonlyArray<Event>, newState: State) => void)
  ) => Effect.Effect<
    { readonly events: ReadonlyArray<Event>; readonly newState: State },
    Error,
    never
  >
  readonly thenNothing: Effect.Effect<
    { readonly events: ReadonlyArray<Event>; readonly newState: State },
    Error,
    never
  >
  readonly thenFails: <Tag extends Error["_tag"]>(
    expectedTag: Tag,
    check?: (error: Extract<Error, { readonly _tag: Tag }>) => void
  ) => Effect.Effect<Extract<Error, { readonly _tag: Tag }>, never, never>
}

export interface DeciderSpecGiven<
  State,
  Command,
  Event,
  Error extends { readonly _tag: string }
> {
  readonly when: (command: Command) => DeciderSpecWhen<State, Event, Error>
}

export interface DeciderSpecRunner<
  State,
  Command,
  Event,
  Error extends { readonly _tag: string }
> {
  readonly given: (
    pastEvents: ReadonlyArray<Event>
  ) => DeciderSpecGiven<State, Command, Event, Error>
}

const isPartialSubsetMatch = (actual: unknown, expectedPartial: unknown): boolean => {
  if (Object.is(actual, expectedPartial)) {
    return true
  }
  if (
    typeof actual !== "object" ||
    actual === null ||
    typeof expectedPartial !== "object" ||
    expectedPartial === null
  ) {
    return false
  }
  if (Array.isArray(expectedPartial)) {
    if (!Array.isArray(actual) || actual.length !== expectedPartial.length) {
      return false
    }
    return expectedPartial.every((item, idx) => isPartialSubsetMatch(actual[idx], item))
  }
  const actualRecord = actual as Record<string, unknown>
  const expectedRecord = expectedPartial as Record<string, unknown>
  for (const key of Object.keys(expectedRecord)) {
    if (!(key in actualRecord)) {
      return false
    }
    if (!isPartialSubsetMatch(actualRecord[key], expectedRecord[key])) {
      return false
    }
  }
  return true
}

export const DeciderSpec = {
  for: <
    State,
    Command,
    Event,
    Error extends { readonly _tag: string }
  >(
    decider: Decider<State, Command, Event, Error>
  ): DeciderSpecRunner<State, Command, Event, Error> => ({
    given: (pastEvents: ReadonlyArray<Event>) => ({
      when: (command: Command) => ({
        thenEvents: (expected) =>
          Effect.gen(function* () {
            const priorState = decider.fold(pastEvents)
            const events = yield* decider.decide(command, priorState)
            const newState = decider.fold(events, priorState)

            if (typeof expected === "function") {
              expected(events, newState)
            } else {
              if (events.length !== expected.length) {
                return yield* Effect.die(
                  new Error(
                    `DeciderSpec.thenEvents: expected ${expected.length} event(s), but got ${events.length}: ${JSON.stringify(events)}`
                  )
                )
              }
              for (let i = 0; i < expected.length; i++) {
                const actualEvent = events[i]
                const expectedEvent = expected[i]
                if (!isPartialSubsetMatch(actualEvent, expectedEvent)) {
                  return yield* Effect.die(
                    new Error(
                      `DeciderSpec.thenEvents: event at index ${i} did not match partial expectation.\nActual: ${JSON.stringify(actualEvent)}\nExpected: ${JSON.stringify(expectedEvent)}`
                    )
                  )
                }
              }
            }

            return { events, newState }
          }),
        thenNothing: Effect.gen(function* () {
          const priorState = decider.fold(pastEvents)
          const events = yield* decider.decide(command, priorState)
          if (events.length !== 0) {
            return yield* Effect.die(
              new Error(
                `DeciderSpec.thenNothing: expected 0 events (no-op), but got ${events.length}: ${JSON.stringify(events)}`
              )
            )
          }
          return { events, newState: priorState }
        }),
        thenFails: <Tag extends Error["_tag"]>(
          expectedTag: Tag,
          check?: (error: Extract<Error, { readonly _tag: Tag }>) => void
        ) =>
          Effect.gen(function* () {
            const priorState = decider.fold(pastEvents)
            const exit = yield* Effect.exit(decider.decide(command, priorState))
            if (exit._tag === "Success") {
              return yield* Effect.die(
                new Error(
                  `DeciderSpec.thenFails: expected failure with tag "${expectedTag}", but succeeded with events: ${JSON.stringify(exit.value)}`
                )
              )
            }
            const cause = exit.cause
            const failReasons = cause.reasons.filter(
              (r): r is Extract<(typeof cause.reasons)[number], { readonly _tag: "Fail" }> =>
                r._tag === "Fail"
            )
            const firstFail = failReasons[0]
            if (!firstFail) {
              return yield* Effect.die(
                new Error(
                  `DeciderSpec.thenFails: expected typed failure "${expectedTag}", but exited with defect/interruption`
                )
              )
            }
            const err = firstFail.error
            if (err._tag !== expectedTag) {
              return yield* Effect.die(
                new Error(
                  `DeciderSpec.thenFails: expected error tag "${expectedTag}", but got "${err._tag}"`
                )
              )
            }
            const narrowed = err as Extract<Error, { readonly _tag: Tag }>
            if (check) {
              check(narrowed)
            }
            return narrowed
          })
      })
    })
  })
} as const
