import path from "node:path";
import { createDeepClause } from "deepclause-sdk";
import type { DeepClauseSDK, DMLEvent } from "deepclause-sdk";
import { createBackend } from "./backend.js";
import { harnessRoot, loadManifest, loadSkillSource } from "./harness.js";
import { registerHarnessTools } from "./tools.js";
import { Sandbox } from "./sandbox.js";

export interface Session {
  id: string;
  controller: AbortController;
  resolveInput?: (value: string) => void;
  rejectInput?: (error: Error) => void;
  sdkPromise?: Promise<DeepClauseSDK>;
  sandbox?: Sandbox;
}

const sessions = new Map<string, Session>();

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
  const session = sessions.get(id);
  if (!session) return false;
  void session.sandbox?.dispose();
  sessions.delete(id);
  return true;
}

export function cancelSession(id: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  session.controller.abort();
  if (session.rejectInput) {
    session.rejectInput(new Error("session cancelled while waiting for input"));
    session.rejectInput = undefined;
    session.resolveInput = undefined;
  }
  return true;
}

export function provideInput(id: string, value: string): boolean {
  const session = sessions.get(id);
  if (!session?.resolveInput) return false;
  session.resolveInput(value);
  session.resolveInput = undefined;
  session.rejectInput = undefined;
  return true;
}

export async function disposeAll(): Promise<void> {
  await Promise.all([...sessions.values()].map((session) => session.sandbox?.dispose()));
}

function sessionSdk(session: Session): Promise<DeepClauseSDK> {
  if (!session.sdkPromise) session.sdkPromise = createSessionSdk(session);
  return session.sdkPromise;
}

async function createSessionSdk(session: Session): Promise<DeepClauseSDK> {
  const manifest = await loadManifest();
  const backend = createBackend(process.env.S2H_LLM_BACKEND?.trim() || "pi");
  const sdk = await createDeepClause({
    model: process.env.S2H_LLM_MODEL?.trim() || "gpt-4o-mini",
    maxTokens: manifest.runtime.maxTokens,
    streaming: true,
    llmBackend: backend,
  });

  const shellNeeded = manifest.runtime.tools.includes("bash") || manifest.runtime.compat.includes("pi_bash");
  if (shellNeeded) {
    const sandbox = manifest.runtime.sandbox;
    const limits = sandbox?.limits ?? { timeoutMs: 120_000, maxOutputBytes: 200_000 };
    session.sandbox = new Sandbox({
      wasmPath: process.env.S2H_AGENTVM_WASM ?? path.join(process.cwd(), "node_modules", "deepclause-agentvm", "agentvm-alpine-python.wasm"),
      harnessRoot: harnessRoot(),
      scratchDir: process.env.S2H_SANDBOX_DIR ?? path.join(process.cwd(), ".sandbox"),
      timeoutMs: limits.timeoutMs,
      maxOutputBytes: limits.maxOutputBytes,
      network: sandbox?.network ?? false,
      allow: sandbox?.allow ?? [],
      networkRateLimit: Number(process.env.S2H_SANDBOX_NETWORK_RATE ?? 2 * 1024 * 1024),
    });
  }

  registerHarnessTools(sdk, harnessRoot(), manifest.runtime.tools, manifest.runtime.compat, session.sandbox);
  return sdk;
}

export interface RunSkillOptions {
  sessionId: string;
  signal?: AbortSignal;
}

export async function* runSkill(skillId: string, message: string, options: RunSkillOptions): AsyncGenerator<DMLEvent> {
  const manifest = await loadManifest();
  const skill = manifest.skills.find((candidate) => candidate.id === skillId);
  if (!skill) throw new Error(`Unknown skill '${skillId}'`);

  const session = getSession(options.sessionId);
  if (!session) throw new Error(`Unknown session '${options.sessionId}'`);

  const sdk = await sessionSdk(session);
  const code = await loadSkillSource(manifest, skill);

  yield* sdk.runDML(code, {
    args: [message],
    workspacePath: harnessRoot(),
    gasLimit: manifest.runtime.gasLimit,
    signal: options.signal ?? session.controller.signal,
    onUserInput: () =>
      new Promise<string>((resolve, reject) => {
        session.resolveInput = resolve;
        session.rejectInput = reject;
        if ((options.signal ?? session.controller.signal).aborted) {
          reject(new Error("session aborted while waiting for input"));
        }
      }),
  });
}
