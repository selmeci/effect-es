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

export interface FileWriteGuardResult {
  readonly verdict: "allow" | "deny" | "ask"
  readonly reason?: string | undefined
}

export const classifyFileWrite = (filePath: string): FileWriteGuardResult => {
  const norm = filePath.replace(/\\/g, "/").trim()
  if (norm === "") {
    return { verdict: "allow" }
  }

  if (/(^|\/)repos\/(effect|alchemy)(\/|$)/.test(norm)) {
    return {
      verdict: "deny",
      reason: `Protected read-only subtree cannot be modified: ${filePath}`
    }
  }

  if (/(^|\/)\.harness\/(worktrees\/[^/]+\/)?verify-stamp\.json$/.test(norm)) {
    return {
      verdict: "deny",
      reason: `Direct modification of verify-stamp.json is forbidden (stamp forgery protection): ${filePath}`
    }
  }

  if (
    /(^|\/)(\.env(\.[a-zA-Z0-9_-]+)?|\.dev\.vars|.*\.(pem|key))$/.test(norm) &&
    !/\.(example|template|sample)$/i.test(norm)
  ) {
    return {
      verdict: "deny",
      reason: `Secret or credential file modification is forbidden by harness guard: ${filePath}`
    }
  }

  if (
    /(^|\/)(\.oxlintrc\.json|tools\/oxlint\/.*|libs\/harness\/graph\/policies\.cedar)$/.test(
      norm
    )
  ) {
    return {
      verdict: "ask",
      reason: `Modifying harness governance/linter policy requires human confirmation: ${filePath}`
    }
  }

  return { verdict: "allow" }
}
