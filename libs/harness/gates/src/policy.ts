/** Deterministic guard policy. `classifyCommand` never calls the decision model:
 * "escalate" means "deterministic rules left this open" (mvp.md, safety guard row). */

export type GuardVerdict = "allow" | "deny" | "escalate"

export const ALLOWLIST: ReadonlyArray<string> = ["nx ", "pnpm test", "pnpm nx ", "pnpm verify"]

export const DENYLIST: ReadonlyArray<{ readonly token: string; readonly reason: string }> = [
  { token: "rm -rf", reason: "destructive delete" },
  { token: ".env", reason: "secret file access" },
  { token: "push --force", reason: "force push" },
  { token: "push -f", reason: "force push" }
]

const containsToken = (command: string, token: string): boolean =>
  command.toLowerCase().includes(token.toLowerCase())

export const classifyCommand = (command: string): GuardVerdict => {
  for (const entry of DENYLIST) {
    if (containsToken(command, entry.token)) {
      return "deny"
    }
  }
  const allowed = ALLOWLIST.some((prefix) => command.startsWith(prefix))
  return allowed ? "allow" : "escalate"
}
