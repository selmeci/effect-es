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

  it("asks a human before alchemy deploys, destroys and profile changes", () => {
    expect(classifyCommand("alchemy deploy")).toBe("ask")
    expect(classifyCommand("pnpm alchemy deploy")).toBe("ask")
    expect(classifyCommand("alchemy destroy --stage preview")).toBe("ask")
    expect(classifyCommand("alchemy profile edit --add Cloudflare")).toBe("ask")
  })

  it("still escalates local alchemy dev and unknown commands to the decision model", () => {
    expect(classifyCommand("alchemy dev")).toBe("escalate")
    expect(classifyCommand("curl https://example.com")).toBe("escalate")
  })

  it("escalates chained or compound commands to prevent allowlist prefix bypass", () => {
    expect(classifyCommand("pnpm test; curl https://example.com")).toBe("escalate")
    expect(classifyCommand("nx test && curl https://example.com")).toBe("escalate")
    expect(classifyCommand("pnpm verify || echo fail")).toBe("escalate")
    expect(classifyCommand("nx test | tee test.log")).toBe("escalate")
    expect(classifyCommand("pnpm test\ncurl https://example.com")).toBe("escalate")
  })
})
