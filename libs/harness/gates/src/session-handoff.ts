import { Effect } from "effect"
import type { FrictionCluster } from "./friction-log.js"

export interface SessionHandoffInput {
  readonly stampValid: boolean
  readonly stampReason?: string | undefined
  readonly activeStubs: ReadonlyArray<string>
  readonly missingPlannedFns: ReadonlyArray<string>
  readonly frictionClusters: ReadonlyArray<FrictionCluster>
}

export interface SessionHandoffSummary {
  readonly hasActiveTask: boolean
  readonly stampValid: boolean
  readonly activeStubs: ReadonlyArray<string>
  readonly missingPlannedFns: ReadonlyArray<string>
  readonly recentFrictionCount: number
  readonly topFrictionSummary: ReadonlyArray<string>
  readonly handoffMessage: string | null
}

export const decideSessionHandoff = Effect.fn("SessionHandoff.decide")(function* (
  input: SessionHandoffInput
) {
  yield* Effect.void

  const recentFrictionCount = input.frictionClusters.reduce(
    (acc, c) => acc + c.occurrences,
    0
  )
  const topFrictionSummary = input.frictionClusters
    .slice(0, 3)
    .map((c) => `[${c.kind} x${c.occurrences}] ${c.summary}`)

  const hasActiveTask =
    !input.stampValid ||
    input.activeStubs.length > 0 ||
    input.missingPlannedFns.length > 0 ||
    input.frictionClusters.length > 0

  let handoffMessage: string | null = null

  if (hasActiveTask) {
    const lines: Array<string> = ["[Harness Context Handoff]"]
    if (input.activeStubs.length > 0) {
      lines.push(`Active stub() skeletons remaining: ${input.activeStubs.join(", ")}`)
    }
    if (input.missingPlannedFns.length > 0) {
      lines.push(
        `Missing planned functions from plan-graph-snapshot: ${input.missingPlannedFns.join(", ")}`
      )
    }
    if (!input.stampValid) {
      lines.push(`Verify stamp status: INVALID (${input.stampReason ?? "unverified"})`)
    }
    if (topFrictionSummary.length > 0) {
      lines.push(`Recent friction events: ${topFrictionSummary.join("; ")}`)
    }
    handoffMessage = lines.join("\n")
  }

  return {
    hasActiveTask,
    stampValid: input.stampValid,
    activeStubs: input.activeStubs,
    missingPlannedFns: input.missingPlannedFns,
    recentFrictionCount,
    topFrictionSummary,
    handoffMessage
  } satisfies SessionHandoffSummary
})

export const buildSessionHandoff = (
  input: SessionHandoffInput
): SessionHandoffSummary => Effect.runSync(decideSessionHandoff(input))
