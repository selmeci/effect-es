declare var console: {
  log(...data: ReadonlyArray<unknown>): void
  error(...data: ReadonlyArray<unknown>): void
}

declare var process: {
  readonly argv: ReadonlyArray<string>
  exit(code: number): never
}
