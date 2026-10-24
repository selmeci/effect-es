const COMMANDS = ["guard", "route", "done", "ingest", "verify", "session", "help"] as const
type Command = (typeof COMMANDS)[number]

const isCommand = (value: string): value is Command =>
  (COMMANDS as readonly string[]).includes(value)

const run = (argv: ReadonlyArray<string>): number => {
  const requested = argv[0] ?? "help"
  if (!isCommand(requested)) {
    console.error(`unknown command: ${requested}`)
    console.error(`usage: harness <${COMMANDS.join("|")}>`)
    return 1
  }
  console.log(`harness ${requested}`)
  return 0
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("index.ts")) {
  process.exit(run(process.argv.slice(2)))
}

export { COMMANDS, run }
export type { Command }
