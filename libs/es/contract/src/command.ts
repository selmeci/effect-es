import { Schema } from "effect"

export const CommandMetadata = Schema.Struct({
  commandId: Schema.String,
  aggregateId: Schema.String,
  timestamp: Schema.Int,
  correlationId: Schema.optional(Schema.String),
  causationId: Schema.optional(Schema.String)
})
export type CommandMetadata = typeof CommandMetadata.Type

export interface CommandEnvelope<C = unknown> {
  readonly command: C
  readonly metadata: CommandMetadata
}
