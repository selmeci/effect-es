import { Schema } from "effect"

export * from "./decider.js"

// ============================================================================
// Core Event Sourcing Contracts (effect-es)
// ============================================================================

export const EventMetadata = Schema.Struct({
  aggregateId: Schema.NonEmptyString,
  streamVersion: Schema.Natural,
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

export const CreatedCommandResult = <
  StateSchema extends Schema.Top,
  EventSchema extends Schema.Top
>(
  stateSchema: StateSchema,
  eventSchema: EventSchema
) =>
  Schema.TaggedStruct("Created", {
    newState: stateSchema,
    appendedEvents: Schema.NonEmptyArray(eventSchema),
    nextExpectedStreamVersion: Schema.Natural
  })

export const AppendedCommandResult = <
  StateSchema extends Schema.Top,
  EventSchema extends Schema.Top
>(
  stateSchema: StateSchema,
  eventSchema: EventSchema
) =>
  Schema.TaggedStruct("Appended", {
    newState: stateSchema,
    appendedEvents: Schema.Array(eventSchema),
    nextExpectedStreamVersion: Schema.Natural
  })

export const makeCommandResultSchema = <
  StateSchema extends Schema.Top,
  EventSchema extends Schema.Top
>(
  stateSchema: StateSchema,
  eventSchema: EventSchema
) =>
  Schema.Union([
    CreatedCommandResult(stateSchema, eventSchema),
    AppendedCommandResult(stateSchema, eventSchema)
  ])

export type CommandResult<State, Event> =
  | {
      readonly _tag: "Created"
      readonly newState: State
      readonly appendedEvents: ReadonlyArray<Event>
      readonly nextExpectedStreamVersion: number
    }
  | {
      readonly _tag: "Appended"
      readonly newState: State
      readonly appendedEvents: ReadonlyArray<Event>
      readonly nextExpectedStreamVersion: number
    }

