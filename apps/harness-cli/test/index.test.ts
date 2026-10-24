import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import { COMMANDS, run } from "../src/index.js"

describe("harness cli", () => {
  it("accepts every registered command", () => {
    for (const command of COMMANDS) {
      expect(run([command])).toBe(0)
    }
  })

  it("rejects unknown commands with exit code 1", () => {
    expect(run(["nonsense"])).toBe(1)
  })

  it("prints usage on the help command", () => {
    const usage = execFileSync("node", ["src/index.ts", "help"], {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8"
    })
    expect(usage).toContain("harness help")
  })
})
