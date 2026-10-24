import { Effect, Schema } from "effect"

export const GreetInput = Schema.Struct({ name: Schema.String })
export type GreetInput = typeof GreetInput.Type

export const greet = Effect.fn("Sample.greet")(function* (input: GreetInput) {
  return `Hello, ${input.name}!`
})
