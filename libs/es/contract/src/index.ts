import { Schema } from "effect"

export * from "./decider.js"

// ============================================================================
// Core Event Sourcing Contracts (effect-es)
// ============================================================================

export const EventMetadata = Schema.Struct({
  aggregateId: Schema.NonEmptyString,
  streamVersion: Schema.Int,
  commandId: Schema.NonEmptyString,
  correlationId: Schema.NonEmptyString,
  causationId: Schema.NonEmptyString,
  timestamp: Schema.Int
})
export type EventMetadata = typeof EventMetadata.Type

export const makeStoredEventSchema = <S extends Schema.Top>(eventSchema: S) =>
  Schema.Struct({
    event: eventSchema,
    metadata: EventMetadata
  })

export const makeCommandResultSchema = <
  StateSchema extends Schema.Top,
  EventSchema extends Schema.Top
>(
  stateSchema: StateSchema,
  eventSchema: EventSchema
) =>
  Schema.Struct({
    newState: stateSchema,
    appendedEvents: Schema.Array(eventSchema),
    nextExpectedStreamVersion: Schema.Int,
    created: Schema.Boolean
  })

export interface CommandResult<State, Event> {
  readonly newState: State
  readonly appendedEvents: ReadonlyArray<Event>
  readonly nextExpectedStreamVersion: number
  readonly created: boolean
}
