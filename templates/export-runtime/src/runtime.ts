import path from "node:path";
import { createRequire } from "node:module";
import {
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { DMLEvent } from "deepclause-sdk";
import { harnessRoot } from "./harness.js";

const require = createRequire(import.meta.url);

export type RunEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "trace"; text: string }
  | { type: "tool"; name: string; state: "start" | "end"; args?: unknown; result?: unknown; isError?: boolean };

export interface PendingRun {
  iterator: AsyncGenerator<DMLEvent>;
  nextPromise: Promise<IteratorResult<DMLEvent>>;
  skillId: string;
  reason: string;
}

export interface Session {
  id: string;
  controller: AbortController;
  sessionPromise?: Promise<AgentSession>;
  running?: boolean;
  resolveInput?: (value: string) => void;
  rejectInput?: (error: Error) => void;
  pendingRun?: PendingRun;
}

const sessions = new Map<string, Session>();

function deepClausePiDir(): string {
  return path.dirname(require.resolve("deepclause-pi/package.json"));
}

export function createSession(id: string): Session {
  const existing = sessions.get(id);
  if (existing) return existing;
  const session: Session = { id, controller: new AbortController() };
  sessions.set(id, session);
  return session;
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function deleteSession(id: string): boolean {
  return sessions.delete(id);
}

export function cancelSession(id: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  session.controller.abort();
  return true;
}

function agentSession(session: Session): Promise<AgentSession> {
  if (!session.sessionPromise) session.sessionPromise = createAgentSessionForRuntime(session);
  return session.sessionPromise;
}

async function createAgentSessionForRuntime(session: Session): Promise<AgentSession> {
  const modelRuntime = await ModelRuntime.create();
  const settings = SettingsManager.inMemory({ compaction: { enabled: false } });

  const loader = new DefaultResourceLoader({
    cwd: harnessRoot(),
    agentDir: getAgentDir(),
    settingsManager: settings,
    additionalExtensionPaths: [path.join(deepClausePiDir(), "src", "index.ts")],
    additionalSkillPaths: [path.join(deepClausePiDir(), "skills")],
  });
  await loader.reload();

  const { session: agent } = await createAgentSession({
    cwd: harnessRoot(),
    agentDir: getAgentDir(),
    modelRuntime,
    settingsManager: settings,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(harnessRoot()),
    tools: ["read", "grep", "find", "ls", "dc_run"],
  });

  await agent.bindExtensions({});

  return agent;
}

function extractPartialText(partial: unknown): string {
  if (!partial || typeof partial !== "object") return "";
  const candidate = partial as { content?: Array<{ type?: string; text?: string }> };
  return (candidate.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

function assistantText(agent: AgentSession): string {
  const messages = agent.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as { role?: string; content?: Array<{ type?: string; text?: string }> };
    if (message?.role !== "assistant") continue;
    const text = (message.content ?? [])
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("");
    if (text.trim()) return text;
  }
  return "";
}

export async function disposeAll(): Promise<void> {
  // Agent sessions hold in-memory state; nothing to flush on shutdown.
}

export function provideInput(_id: string, _value: string): boolean {
  return false;
}

export async function* runSkill(skillId: string, message: string, options: { sessionId: string; signal?: AbortSignal; onEvent?: (event: RunEvent) => void }): AsyncGenerator<DMLEvent> {
  const prompt = `Run the "${skillId}" skill for this request:\n\n${message}`;
  const answer = await runTurn(options.sessionId, prompt, { signal: options.signal, onEvent: options.onEvent });
  yield { type: "answer", content: answer } as DMLEvent;
}

export interface RunTurnOptions {
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
}

export async function runTurn(sessionId: string, message: string, options: RunTurnOptions = {}): Promise<string> {
  const session = getSession(sessionId);
  if (!session) throw new Error(`Unknown session '${sessionId}'`);

  const agent = await agentSession(session);
  const unsubscribe = agent.subscribe((event) => {
    switch (event.type) {
      case "message_update": {
        const update = event.assistantMessageEvent;
        if (update.type === "text_delta") options.onEvent?.({ type: "text", delta: update.delta });
        else if (update.type === "thinking_delta") options.onEvent?.({ type: "thinking", delta: update.delta });
        break;
      }
      case "tool_execution_start":
        options.onEvent?.({ type: "tool", name: event.toolName, state: "start", args: (event as { args?: unknown }).args });
        break;
      case "tool_execution_update": {
        if (event.toolName === "dc_run") {
          const partial = (event as { partialResult?: unknown }).partialResult;
          const text = extractPartialText(partial);
          if (text) options.onEvent?.({ type: "trace", text });
        }
        break;
      }
      case "tool_execution_end":
        options.onEvent?.({
          type: "tool",
          name: event.toolName,
          state: "end",
          result: (event as { result?: unknown }).result,
          isError: (event as { isError?: boolean }).isError,
        });
        break;
      default:
        break;
    }
  });

  try {
    await agent.prompt(message);
    return assistantText(agent) || "(no answer)";
  } finally {
    unsubscribe();
  }
}
