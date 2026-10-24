import { Schema } from "effect"

export const TRACE_FORMAT_VERSION = 1

export const TraceHeader = Schema.Struct({
  kind: Schema.Literal("header"),
  version: Schema.Literal(1),
  language: Schema.String,
  repo_root: Schema.String,
  tracer: Schema.String,
  sampled: Schema.Boolean
})
export type TraceHeader = typeof TraceHeader.Type

export const makeTraceHeader = (repoRoot: string): TraceHeader => ({
  kind: "header",
  version: TRACE_FORMAT_VERSION,
  language: "javascript",
  repo_root: repoRoot,
  tracer: "effect-span",
  sampled: false
})
