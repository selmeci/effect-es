import { Effect } from "effect"

export const logToConsole = (message: string) =>
  Effect.sync(() => {
    console.log(message)
  })
