import { describe, expect, it } from "vitest"
import { classifyCommand } from "../src/policy.js"

describe("guard policy", () => {
  it("allows nx and pnpm test commands", () => {
    expect(classifyCommand("nx test @harness/ingest")).toBe("allow")
    expect(classifyCommand("pnpm test")).toBe("allow")
  })

  it("denies rm -rf outside the workspace, .env and force pushes", () => {
    expect(classifyCommand("rm -rf /home")).toBe("deny")
    expect(classifyCommand("cat .env")).toBe("deny")
    expect(classifyCommand("git push --force origin main")).toBe("deny")
  })

  it("escalates unknown commands to the decision model", () => {
    expect(classifyCommand("curl https://example.com")).toBe("escalate")
  })
})
