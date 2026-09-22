import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DMLEvent } from "deepclause-sdk";
import { loadManifest, type HarnessManifest } from "./harness.js";
import { routeRequest } from "./router.js";
import { createSession, getSession, provideInput, runSkill, type Session } from "./runtime.js";

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
}

interface RouteInfo {
  skillId: string;
  reason: string;
}

function describeHarness(manifest: HarnessManifest): string {
  const procedures = manifest.skills
    .map((skill) => `"${skill.triggers[0] ?? skill.id}" -> ${skill.title}`)
    .join("; ");
  const effects = manifest.skills.every((skill) => skill.effects === "none") ? "none" : "declared";
  return `Run the "${manifest.title ?? manifest.name}" harness (${manifest.name} v${manifest.version}). Procedures: ${procedures}. Effects: ${effects}.`;
}

export async function createMcpServer(): Promise<McpServer> {
  const manifest = await loadManifest();
  const prefix = process.env.S2H_MCP_TOOL_PREFIX?.trim() || "s2h";
  const toolName = `${prefix}__${process.env.S2H_MCP_TOOL_NAME?.trim() || "run"}`;

  const mcp = new McpServer(
    { name: manifest.name, version: manifest.version },
    { capabilities: { tools: {} } },
  );

  mcp.registerTool(
    toolName,
    {
      title: manifest.title ?? manifest.name,
      description: describeHarness(manifest),
      inputSchema: {
        message: z.string().optional().describe("Natural-language request for the harness"),
        skill: z.string().optional().describe("Force a skill id instead of routing"),
        sessionId: z.string().optional(),
        context: z.enum(["turn", "branch", "isolated"]).optional(),
        answer: z.string().optional().describe("Answer to a pending input_required prompt"),
      },
    },
    async (args, extra) => {
      const sessionId = args.sessionId ?? `mcp-${randomUUID()}`;
      const progressToken = (extra as { _meta?: { progressToken?: string | number } })._meta?.progressToken;
      const signal = (extra as { signal?: AbortSignal }).signal;

      // Resume a run that returned inputRequired.
      if (typeof args.answer === "string" && args.answer.length > 0) {
        const session = getSession(sessionId);
        if (!session?.pendingRun) {
          return {
            content: [{ type: "text", text: "No pending input for this session." }],
            structuredContent: { inputRequired: false, sessionId },
          };
        }
        const pending = session.pendingRun;
        session.pendingRun = undefined;
        if (!provideInput(sessionId, args.answer)) {
          return {
            content: [{ type: "text", text: "No pending input for this session." }],
            structuredContent: { inputRequired: false, sessionId },
          };
        }
        const first = await pending.nextPromise;
        return consumeRun(session, pending.iterator, first, manifest, { skillId: pending.skillId, reason: pending.reason }, mcp, progressToken);
      }

      if (getSession(sessionId)) {
        return {
          content: [{ type: "text", text: "A run is already active for this session." }],
          structuredContent: { inputRequired: false, sessionId },
        };
      }

      if (typeof args.message !== "string" || args.message.trim() === "") {
        return {
          content: [{ type: "text", text: "message is required for a new run." }],
          structuredContent: { inputRequired: false, sessionId },
        };
      }

      const route = routeRequest(manifest, args.message, args.skill);
      if (!route.skill) {
        return {
          content: [{ type: "text", text: "Could not route the request to a skill." }],
          structuredContent: { inputRequired: true, sessionId, prompt: "Which procedure should handle this request?" },
        };
      }

      const session = createSession(sessionId);
      const iterator = runSkill(route.skill.id, args.message, { sessionId, signal });
      return consumeRun(session, iterator, await iterator.next(), manifest, { skillId: route.skill.id, reason: route.reason }, mcp, progressToken);
    },
  );

  return mcp;
}

async function consumeRun(
  session: Session,
  iterator: AsyncGenerator<DMLEvent>,
  first: IteratorResult<DMLEvent>,
  manifest: HarnessManifest,
  route: RouteInfo,
  mcp: McpServer,
  progressToken: string | number | undefined,
): Promise<ToolResult> {
  let answer = "";
  let usage: unknown;
  let progress = 0;

  const notify = async (message: string): Promise<void> => {
    if (progressToken === undefined || progressToken === null) return;
    try {
      await (mcp.server as unknown as { notification: (notification: unknown) => Promise<void> }).notification({
        method: "notifications/progress",
        params: { progressToken, progress: progress++, message },
      });
    } catch {
      // progress is best-effort
    }
  };

  let result = first;
  for (;;) {
    if (result.done) break;
    const event = result.value;

    switch (event.type) {
      case "answer":
        answer = event.content ?? answer;
        break;
      case "stream":
      case "output":
      case "log":
        await notify(event.content ?? "");
        break;
      case "tool_call":
        await notify(`${event.toolName} ${event.toolState ?? ""}`);
        if (event.toolName === "ask_user" && (event.toolState === "starting" || event.toolState === "running")) {
          const prompt = String((event.toolArgs as Record<string, unknown> | undefined)?.prompt ?? "");
          const nextPromise = iterator.next();
          void nextPromise.catch(() => {});
          session.pendingRun = { iterator, nextPromise, skillId: route.skillId, reason: route.reason };
          return {
            content: [{ type: "text", text: prompt || "Input required" }],
            structuredContent: {
              harness: manifest.name,
              version: manifest.version,
              skill: route.skillId,
              inputRequired: true,
              sessionId: session.id,
              prompt,
            },
          };
        }
        break;
      case "task_activity":
        if (event.taskDescription) await notify(event.taskDescription);
        break;
      case "usage":
        usage = event.usage;
        break;
      case "input_required": {
        // Advance the generator so the SDK installs its onUserInput waiter,
        // then suspend and return the inputRequired fallback.
        const nextPromise = iterator.next();
        void nextPromise.catch(() => {});
        session.pendingRun = { iterator, nextPromise, skillId: route.skillId, reason: route.reason };
        return {
          content: [{ type: "text", text: event.prompt ?? "Input required" }],
          structuredContent: {
            harness: manifest.name,
            version: manifest.version,
            skill: route.skillId,
            inputRequired: true,
            sessionId: session.id,
            prompt: event.prompt ?? "",
          },
        };
      }
      case "error":
        throw new Error(event.content ?? "runtime error");
      case "finished":
      case "memory_compaction":
        break;
    }

    result = await iterator.next();
  }

  return {
    content: [{ type: "text", text: answer || "(no answer)" }],
    structuredContent: {
      harness: manifest.name,
      version: manifest.version,
      skill: route.skillId,
      route: { skill: route.skillId, reason: route.reason },
      answer: answer || "",
      usage,
      inputRequired: false,
      sessionId: session.id,
    },
  };
}
