/** Deterministic guard policy. `classifyCommand` never calls the decision model:
 * "escalate" means "deterministic rules left this open" (mvp.md, safety guard row);
 * "ask" means "always confirm with the human first" (alchemy deploy/destroy/profile,
 * matching Alchemy's own advice to confirm every deploy). */

export type GuardVerdict = "allow" | "deny" | "ask" | "escalate"

export const ALLOWLIST: ReadonlyArray<string> = ["nx ", "pnpm test", "pnpm nx ", "pnpm verify"]

export const DENYLIST: ReadonlyArray<{ readonly token: string; readonly reason: string }> = [
  { token: "rm -rf", reason: "destructive delete" },
  { token: ".env", reason: "secret file access" },
  { token: "push --force", reason: "force push" },
  { token: "push -f", reason: "force push" }
]

/** Human confirmation required, never auto-approved (mvp.md "Infrastructure as Effect",
 * safety guard row). Substring match, so `pnpm alchemy deploy` is covered too. */
export const ASKLIST: ReadonlyArray<string> = [
  "alchemy deploy",
  "alchemy destroy",
  "alchemy profile"
]

export const SHELL_OPERATORS: ReadonlyArray<string> = ["&&", "||", ";", "|", "\n"]

const containsToken = (command: string, token: string): boolean =>
  command.toLowerCase().includes(token.toLowerCase())

export const classifyCommand = (command: string): GuardVerdict => {
  for (const entry of DENYLIST) {
    if (containsToken(command, entry.token)) {
      return "deny"
    }
  }
  if (ASKLIST.some((token) => containsToken(command, token))) {
    return "ask"
  }
  if (SHELL_OPERATORS.some((op) => command.includes(op))) {
    return "escalate"
  }
  const allowed = ALLOWLIST.some((prefix) => command.startsWith(prefix))
  return allowed ? "allow" : "escalate"
}
