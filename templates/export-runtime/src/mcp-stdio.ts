import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp.js";

const server = await createMcpServer();
await server.connect(new StdioServerTransport());
