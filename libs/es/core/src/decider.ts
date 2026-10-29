import { Effect } from "effect"

export interface Decider<State, Command, Event, Error> {
  readonly initialState: State | (() => State)
  readonly evolve: (state: State, event: Event) => State
  readonly decide: (command: Command, state: State) => Effect.Effect<ReadonlyArray<Event>, Error, never>
}

export interface DeciderParams<State, Command, Event, Error> {
  readonly initialState: State | (() => State)
  readonly evolve: (state: State, event: Event) => State
  readonly decide: (command: Command, state: State) => Effect.Effect<ReadonlyArray<Event>, Error, never>
}

export const make = Effect.fn("Decider.make")(function* <State, Command, Event, Error>(
  params: DeciderParams<State, Command, Event, Error>
): Effect.fn.Return<Decider<State, Command, Event, Error>, never, never> {
  const decider: Decider<State, Command, Event, Error> = {
    initialState: params.initialState,
    evolve: params.evolve,
    decide: params.decide
  }
  return yield* Effect.succeed(decider)
})

export const decide = Effect.fn("Decider.decide")(function* <State, Command, Event, Error>(
  decider: Decider<State, Command, Event, Error>,
  state: State,
  command: Command
): Effect.fn.Return<ReadonlyArray<Event>, Error, never> {
  return yield* decider.decide(command, state)
})

export const evolve = Effect.fn("Decider.evolve")(function* <State, Command, Event, Error>(
  decider: Decider<State, Command, Event, Error>,
  state: State,
  events: ReadonlyArray<Event>
): Effect.fn.Return<State, never, never> {
  let current = state
  for (const event of events) {
    current = decider.evolve(current, event)
  }
  return yield* Effect.succeed(current)
})
