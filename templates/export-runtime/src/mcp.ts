import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadManifest, type HarnessManifest } from "./harness.js";
import { createSession, runSkill } from "./runtime.js";

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "skill";
}

function routingTable(manifest: HarnessManifest): string {
  const rows = manifest.skills
    .map((skill) => `| ${skill.triggers.join(", ")} | \`${skill.id}\` | ${skill.effects || "none"} |`)
    .join("\n");
  return `| Procedure / trigger | Tool | Effects |\n| --- | --- | --- |\n${rows}`;
}

function usagePrompt(manifest: HarnessManifest): string {
  return [
    `Use the tools below to run "${manifest.title ?? manifest.name}" (${manifest.name} v${manifest.version}).`,
    manifest.description ? `\n${manifest.description}` : "",
    "",
    "Each tool runs one procedure from the harness. Send the user's request as `message`; the tool returns the procedure's answer.",
    "",
    "Routing table:",
    routingTable(manifest),
  ].filter(Boolean).join("\n");
}

export async function createMcpServer(): Promise<McpServer> {
  const manifest = await loadManifest();
  const prefix = process.env.S2H_MCP_TOOL_PREFIX?.trim() || "s2h";

  const mcp = new McpServer(
    { name: manifest.name, version: manifest.version },
    { capabilities: { tools: {}, prompts: {} } },
  );

  // One tool per harness skill.
  for (const skill of manifest.skills) {
    const toolName = `${prefix}__${slugify(skill.id)}`;
    mcp.registerTool(
      toolName,
      {
        title: skill.title,
        description: `${skill.title}. Triggers: ${skill.triggers.join(", ")}. Effects: ${skill.effects || "none"}.`,
        inputSchema: {
          message: z.string().describe("The user's natural-language request for this procedure"),
          sessionId: z.string().optional().describe("Reuse a session for follow-up turns"),
        },
        annotations: {
          readOnlyHint: (skill.effects ?? "none") === "none",
          openWorldHint: false,
        },
      },
      async (args, extra) => {
        const sessionId = args.sessionId ?? `mcp-${randomUUID()}`;
        const session = createSession(sessionId);
        let answer = "(no answer)";
        for await (const event of runSkill(skill.id, args.message, { sessionId, signal: extra.signal })) {
          if (event.type === "answer" && typeof event.content === "string") answer = event.content;
          if (event.type === "error" && typeof event.content === "string") answer = event.content;
        }
        return {
          content: [{ type: "text", text: answer }],
          structuredContent: { harness: manifest.name, version: manifest.version, skill: skill.id, answer },
        };
      },
    );
  }

  // One prompt that explains the harness and its routing table.
  mcp.registerPrompt(
    `${prefix}__usage`,
    {
      title: `How to use ${manifest.title ?? manifest.name}`,
      description: "General explanation of the harness and the routing table for its skill tools.",
    },
    () => ({
      description: `How to use ${manifest.title ?? manifest.name}`,
      messages: [{ role: "user", content: { type: "text", text: usagePrompt(manifest) } }],
    }),
  );

  return mcp;
}
