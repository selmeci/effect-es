import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

export const createServer = (): McpServer =>
  new McpServer({ name: "harness-mcp", version: "0.0.0" })
