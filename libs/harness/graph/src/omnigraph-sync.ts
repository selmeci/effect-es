import { Context, Data, Effect, Layer } from "effect"
import { Omnigraph } from "@modernrelay/omnigraph"
import { saveGraphSnapshot, toOmnigraphNdjson } from "./graph-engine.js"
import type { HarnessGraph } from "./model.js"

export const OmnigraphClient = Omnigraph

export class OmnigraphLoadError extends Data.TaggedError("OmnigraphLoadError")<{
  readonly cause: unknown
}> {}

export interface OmnigraphSyncResult {
  readonly syncedToOmnigraph: boolean
  readonly snapshotPath: string
}

export interface OmnigraphSyncShape {
  readonly sync: (
    graph: HarnessGraph,
    options?: {
      readonly branch?: string
      readonly snapshotPath?: string
      readonly baseUrl?: string
    }
  ) => Effect.Effect<OmnigraphSyncResult>
  readonly mergeBranch: (options?: {
    readonly source?: string
    readonly target?: string
    readonly baseUrl?: string
  }) => Effect.Effect<boolean>
}

export class OmnigraphSync extends Context.Service<OmnigraphSync, OmnigraphSyncShape>()(
  "@harness/graph/OmnigraphSync"
) {
  static readonly Live: Layer.Layer<OmnigraphSync> = Layer.succeed(
    OmnigraphSync,
    OmnigraphSync.of({
      sync: (graph, options) =>
        Effect.gen(function* () {
          const snapshotPath = options?.snapshotPath ?? ".harness/graph-snapshot.json"
          saveGraphSnapshot(graph, snapshotPath)

          const baseUrl =
            options?.baseUrl ??
            process.env.OMNIGRAPH_URL ??
            "http://127.0.0.1:8080"
          const branch = options?.branch ?? "main"

          const og = new Omnigraph({ baseUrl })
          const ndjson = toOmnigraphNdjson(graph)

          const syncResult = yield* Effect.tryPromise({
            try: () => og.load({ branch, mode: "merge", data: ndjson }),
            catch: (cause) => new OmnigraphLoadError({ cause })
          }).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false)
          )

          return {
            syncedToOmnigraph: syncResult,
            snapshotPath
          }
        }),
      mergeBranch: (options) =>
        Effect.gen(function* () {
          const baseUrl =
            options?.baseUrl ??
            process.env.OMNIGRAPH_URL ??
            "http://127.0.0.1:8080"
          const source = options?.source ?? "impl/current"
          const target = options?.target ?? "main"

          const og = new Omnigraph({ baseUrl })

          return yield* Effect.tryPromise({
            try: () => og.branches.merge({ source, target }),
            catch: (cause) => new OmnigraphLoadError({ cause })
          }).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false)
          )
        })
    })
  )
}

export const syncToOmnigraphAndSnapshot = (
  graph: HarnessGraph,
  options?: {
    readonly branch?: string
    readonly snapshotPath?: string
    readonly baseUrl?: string
  }
): Effect.Effect<OmnigraphSyncResult, never, OmnigraphSync> =>
  Effect.flatMap(OmnigraphSync, (service) => service.sync(graph, options))

export const mergeOmnigraphBranch = (options?: {
  readonly source?: string
  readonly target?: string
  readonly baseUrl?: string
}): Effect.Effect<boolean, never, OmnigraphSync> =>
  Effect.flatMap(OmnigraphSync, (service) => service.mergeBranch(options))
