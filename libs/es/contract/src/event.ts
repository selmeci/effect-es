import { Schema } from "effect"

export const EventMetadata = Schema.Struct({
  aggregateId: Schema.String,
  streamVersion: Schema.Natural,
  commandId: Schema.String,
  correlationId: Schema.optional(Schema.String),
  causationId: Schema.optional(Schema.String),
  timestamp: Schema.Int
})
export type EventMetadata = typeof EventMetadata.Type

export interface EventEnvelope<E = unknown> {
  readonly event: E
  readonly metadata: EventMetadata
}
