import { Context, Data, Effect, Layer, Option } from "effect"
import { type Diff, type FetchLike, Omnigraph } from "@modernrelay/omnigraph"
import {
  executeNamedGqQueryInMemory,
  HARNESS_GQ_QUERIES,
  type HarnessGqQueryName
} from "./gq-queries.js"
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

export interface OmnigraphConnectionOptions {
  readonly baseUrl?: string | undefined
  readonly graphId?: string | undefined
  readonly token?: string | undefined
  readonly fetch?: FetchLike | undefined
}

export const makeOmnigraphClient = (
  options?: OmnigraphConnectionOptions
): Omnigraph => {
  const baseUrl =
    options?.baseUrl ?? process.env.OMNIGRAPH_URL ?? "http://127.0.0.1:8080"
  const graphId =
    options?.graphId ?? process.env.OMNIGRAPH_GRAPH_ID ?? "harness"
  const token = options?.token ?? process.env.OMNIGRAPH_TOKEN
  return new Omnigraph({
    baseUrl,
    graphId,
    ...(token ? { token } : {}),
    ...(options?.fetch ? { fetch: options.fetch } : {})
  })
}

export interface OmnigraphSyncShape {
  readonly sync: (
    graph: HarnessGraph,
    options?: OmnigraphConnectionOptions & {
      readonly branch?: string | undefined
      readonly snapshotPath?: string | undefined
      readonly from?: string | undefined
    }
  ) => Effect.Effect<OmnigraphSyncResult>
  readonly mergeBranch: (
    options?: OmnigraphConnectionOptions & {
      readonly source?: string | undefined
      readonly target?: string | undefined
    }
  ) => Effect.Effect<boolean>
  readonly query: (
    input: OmnigraphConnectionOptions & {
      readonly query: string
      readonly name?: string | undefined
      readonly params?: Readonly<Record<string, unknown>> | undefined
      readonly branch?: string | undefined
    }
  ) => Effect.Effect<Option.Option<ReadonlyArray<Record<string, unknown>>>>
  readonly invokeNamedQuery: (
    input: OmnigraphConnectionOptions & {
      readonly name: HarnessGqQueryName
      readonly params?: Readonly<Record<string, unknown>> | undefined
      readonly branch?: string | undefined
      readonly fallbackGraph?: HarnessGraph | undefined
    }
  ) => Effect.Effect<{
    readonly source: "omnigraph" | "memory-fallback"
    readonly rows: ReadonlyArray<Record<string, unknown>>
  }>
  readonly diffBranches: (
    input?: OmnigraphConnectionOptions & {
      readonly source?: string | undefined
      readonly target?: string | undefined
    }
  ) => Effect.Effect<Option.Option<Diff>>
}

export class OmnigraphSync extends Context.Service<OmnigraphSync, OmnigraphSyncShape>()(
  "@harness/graph/OmnigraphSync"
) {
  static readonly Live: Layer.Layer<OmnigraphSync> = Layer.succeed(
    OmnigraphSync,
    OmnigraphSync.of({
      sync: (graph, options) =>
        Effect.gen(function* () {
          const snapshotPath =
            options?.snapshotPath ?? ".harness/graph-snapshot.json"
          saveGraphSnapshot(graph, snapshotPath)

          const branch = options?.branch ?? "main"
          const og = makeOmnigraphClient(options)
          const ndjson = toOmnigraphNdjson(graph)

          const syncResult = yield* Effect.tryPromise({
            try: () =>
              og.load({
                branch,
                ...(branch !== "main" ? { from: options?.from ?? "main" } : {}),
                mode: "merge",
                data: ndjson
              }),
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
          const source = options?.source ?? "impl/current"
          const target = options?.target ?? "main"
          const og = makeOmnigraphClient(options)

          return yield* Effect.tryPromise({
            try: () => og.branches.merge({ source, target }),
            catch: (cause) => new OmnigraphLoadError({ cause })
          }).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false)
          )
        }),

      query: (input) =>
        Effect.gen(function* () {
          const og = makeOmnigraphClient(input)
          return yield* Effect.tryPromise({
            try: () =>
              og.query({
                query: input.query,
                ...(input.name ? { name: input.name } : {}),
                ...(input.params ? { params: input.params } : {}),
                branch: input.branch ?? "main"
              }),
            catch: (cause) => new OmnigraphLoadError({ cause })
          }).pipe(
            Effect.map((res) =>
              Array.isArray(res.rows)
                ? Option.some(res.rows as ReadonlyArray<Record<string, unknown>>)
                : Option.none()
            ),
            Effect.orElseSucceed(() => Option.none())
          )
        }),

      invokeNamedQuery: (input) =>
        Effect.gen(function* () {
          const og = makeOmnigraphClient(input)
          const branch = input.branch ?? "main"

          const invokeAttempt = yield* Effect.tryPromise({
            try: () =>
              og.queries.invoke(input.name, {
                ...(input.params ? { params: input.params } : {}),
                branch,
                expectMutation: false
              }),
            catch: (cause) => new OmnigraphLoadError({ cause })
          }).pipe(
            Effect.map((res) => {
              if (
                res &&
                typeof res === "object" &&
                "rows" in res &&
                Array.isArray((res as { rows: unknown }).rows)
              ) {
                return Option.some(
                  (res as { rows: ReadonlyArray<Record<string, unknown>> }).rows
                )
              }
              return Option.none<ReadonlyArray<Record<string, unknown>>>()
            }),
            Effect.orElseSucceed(() =>
              Option.none<ReadonlyArray<Record<string, unknown>>>()
            )
          )

          if (Option.isSome(invokeAttempt)) {
            return {
              source: "omnigraph" as const,
              rows: invokeAttempt.value
            }
          }

          const queryDescriptor = HARNESS_GQ_QUERIES[input.name]
          const queryAttempt = yield* Effect.tryPromise({
            try: () =>
              og.query({
                query: queryDescriptor.source,
                name: input.name,
                ...(input.params ? { params: input.params } : {}),
                branch
              }),
            catch: (cause) => new OmnigraphLoadError({ cause })
          }).pipe(
            Effect.map((res) => {
              if (
                res &&
                typeof res === "object" &&
                "rows" in res &&
                Array.isArray((res as { rows: unknown }).rows)
              ) {
                return Option.some(
                  (res as { rows: ReadonlyArray<Record<string, unknown>> }).rows
                )
              }
              return Option.none<ReadonlyArray<Record<string, unknown>>>()
            }),
            Effect.orElseSucceed(() =>
              Option.none<ReadonlyArray<Record<string, unknown>>>()
            )
          )

          if (Option.isSome(queryAttempt)) {
            return {
              source: "omnigraph" as const,
              rows: queryAttempt.value
            }
          }

          const fallbackRows = input.fallbackGraph
            ? executeNamedGqQueryInMemory(
                input.fallbackGraph,
                input.name,
                input.params
              )
            : []

          return {
            source: "memory-fallback" as const,
            rows: fallbackRows
          }
        }),

      diffBranches: (input) =>
        Effect.gen(function* () {
          const og = makeOmnigraphClient(input)
          const source = input?.source ?? "impl/current"
          const target = input?.target ?? "plan/current"

          return yield* Effect.tryPromise({
            try: () => og.branches.diff({ source, target }),
            catch: (cause) => new OmnigraphLoadError({ cause })
          }).pipe(
            Effect.asSome,
            Effect.orElseSucceed(() => Option.none())
          )
        })
    })
  )
}

export const syncToOmnigraphAndSnapshot = (
  graph: HarnessGraph,
  options?: OmnigraphConnectionOptions & {
    readonly branch?: string | undefined
    readonly snapshotPath?: string | undefined
    readonly from?: string | undefined
  }
): Effect.Effect<OmnigraphSyncResult, never, OmnigraphSync> =>
  Effect.flatMap(OmnigraphSync, (service) => service.sync(graph, options))

export const mergeOmnigraphBranch = (
  options?: OmnigraphConnectionOptions & {
    readonly source?: string | undefined
    readonly target?: string | undefined
  }
): Effect.Effect<boolean, never, OmnigraphSync> =>
  Effect.flatMap(OmnigraphSync, (service) => service.mergeBranch(options))

export const queryOmnigraph = (
  input: OmnigraphConnectionOptions & {
    readonly query: string
    readonly name?: string | undefined
    readonly params?: Readonly<Record<string, unknown>> | undefined
    readonly branch?: string | undefined
  }
): Effect.Effect<
  Option.Option<ReadonlyArray<Record<string, unknown>>>,
  never,
  OmnigraphSync
> => Effect.flatMap(OmnigraphSync, (service) => service.query(input))

export const invokeOmnigraphNamedQuery = (
  input: OmnigraphConnectionOptions & {
    readonly name: HarnessGqQueryName
    readonly params?: Readonly<Record<string, unknown>> | undefined
    readonly branch?: string | undefined
    readonly fallbackGraph?: HarnessGraph | undefined
  }
): Effect.Effect<
  {
    readonly source: "omnigraph" | "memory-fallback"
    readonly rows: ReadonlyArray<Record<string, unknown>>
  },
  never,
  OmnigraphSync
> => Effect.flatMap(OmnigraphSync, (service) => service.invokeNamedQuery(input))

export const diffOmnigraphBranches = (
  input?: OmnigraphConnectionOptions & {
    readonly source?: string | undefined
    readonly target?: string | undefined
  }
): Effect.Effect<Option.Option<Diff>, never, OmnigraphSync> =>
  Effect.flatMap(OmnigraphSync, (service) => service.diffBranches(input))
