import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Effect, Option, Schema } from "effect"
import { resolveHarnessStateDir } from "./worktree.js"

export const FrictionEventKind = Schema.Literals([
  "route_miss",
  "verify_failure",
  "guard_escalation"
])
export type FrictionEventKind = typeof FrictionEventKind.Type

export const FrictionEvent = Schema.Struct({
  kind: FrictionEventKind,
  timestamp: Schema.String,
  summary: Schema.String,
  detail: Schema.String
})
export type FrictionEvent = typeof FrictionEvent.Type

export interface FrictionCluster {
  readonly key: string
  readonly kind: FrictionEventKind
  readonly summary: string
  readonly detail: string
  readonly occurrences: number
  readonly lastSeen: string
}

export const decideFrictionClusters = Effect.fn("Friction.decide")(function* (
  events: ReadonlyArray<FrictionEvent>
) {
  yield* Effect.void
  const map = new Map<
    string,
    {
      key: string
      kind: FrictionEventKind
      summary: string
      detail: string
      occurrences: number
      lastSeen: string
    }
  >()

  for (const event of events) {
    const key = `${event.kind}::${event.summary.trim().toLowerCase()}`
    const existing = map.get(key)
    if (existing === undefined) {
      map.set(key, {
        key,
        kind: event.kind,
        summary: event.summary,
        detail: event.detail,
        occurrences: 1,
        lastSeen: event.timestamp
      })
    } else {
      existing.occurrences += 1
      const existingTime = Date.parse(existing.lastSeen)
      const eventTime = Date.parse(event.timestamp)
      const isLater =
        !Number.isNaN(eventTime) && !Number.isNaN(existingTime)
          ? eventTime >= existingTime
          : event.timestamp >= existing.lastSeen
      if (isLater) {
        existing.lastSeen = event.timestamp
        existing.detail = event.detail
        existing.summary = event.summary
      }
    }
  }

  const clusters = Array.from(map.values())
  clusters.sort((a, b) => {
    if (b.occurrences !== a.occurrences) {
      return b.occurrences - a.occurrences
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  })

  return clusters as ReadonlyArray<FrictionCluster>
})

export const summarizeFrictionEvents = (
  events: ReadonlyArray<FrictionEvent>
): ReadonlyArray<FrictionCluster> => Effect.runSync(decideFrictionClusters(events))

const decodeFrictionEvent = Schema.decodeOption(Schema.fromJsonString(FrictionEvent))

export const appendFrictionEvent = (
  repoRoot: string,
  input: {
    readonly kind: FrictionEventKind
    readonly summary: string
    readonly detail: string
    readonly timestamp?: string | undefined
  }
): FrictionEvent => {
  const record: FrictionEvent = {
    kind: input.kind,
    timestamp: input.timestamp ?? new Date().toISOString(),
    summary: input.summary,
    detail: input.detail
  }
  const harnessDir = resolveHarnessStateDir(repoRoot)
  const filePath = join(harnessDir, "friction-log.jsonl")
  Effect.runSync(
    Effect.try(() => {
      if (!existsSync(harnessDir)) {
        mkdirSync(harnessDir, { recursive: true })
      }
      appendFileSync(filePath, JSON.stringify(record) + "\n", "utf-8")
    }).pipe(Effect.orElseSucceed(() => undefined))
  )
  return record
}

export const readFrictionEvents = (repoRoot: string): ReadonlyArray<FrictionEvent> => {
  const harnessDir = resolveHarnessStateDir(repoRoot)
  const filePath = join(harnessDir, "friction-log.jsonl")
  if (!existsSync(filePath)) {
    return []
  }
  const contentOption = Effect.runSync(
    Effect.try(() => readFileSync(filePath, "utf-8")).pipe(Effect.option)
  )
  if (Option.isNone(contentOption)) {
    return []
  }
  const lines = contentOption.value.split("\n")
  const events: Array<FrictionEvent> = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const decoded = decodeFrictionEvent(trimmed)
    if (Option.isSome(decoded)) {
      events.push(decoded.value)
    }
  }
  return events
}

export const clearFrictionEvents = (repoRoot: string): void => {
  const harnessDir = resolveHarnessStateDir(repoRoot)
  const filePath = join(harnessDir, "friction-log.jsonl")
  Effect.runSync(
    Effect.try(() => {
      if (!existsSync(harnessDir)) {
        mkdirSync(harnessDir, { recursive: true })
      }
      writeFileSync(filePath, "", "utf-8")
    }).pipe(Effect.orElseSucceed(() => undefined))
  )
}
