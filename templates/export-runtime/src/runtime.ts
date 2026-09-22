import { createDeepClause } from "deepclause-sdk";
import type { DeepClauseSDK, DMLEvent } from "deepclause-sdk";
import { createBackend } from "./backend.js";
import { harnessRoot, loadManifest, loadSkillSource } from "./harness.js";
import { registerHarnessTools } from "./tools.js";

export interface Session {
  id: string;
  controller: AbortController;
  resolveInput?: (value: string) => void;
  rejectInput?: (error: Error) => void;
}

const sessions = new Map<string, Session>();
let sdkPromise: Promise<DeepClauseSDK> | undefined;

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

async function getSdk(): Promise<DeepClauseSDK> {
  if (!sdkPromise) sdkPromise = createSdk();
  return sdkPromise;
}

async function createSdk(): Promise<DeepClauseSDK> {
  const manifest = await loadManifest();
  const backend = createBackend(process.env.S2H_LLM_BACKEND?.trim() || "pi");
  const sdk = await createDeepClause({
    model: process.env.S2H_LLM_MODEL?.trim() || "gpt-4o-mini",
    maxTokens: manifest.runtime.maxTokens,
    streaming: true,
    llmBackend: backend,
  });
  registerHarnessTools(sdk, harnessRoot(), manifest.runtime.tools);
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

  const sdk = await getSdk();
  const code = await loadSkillSource(manifest, skill);
  const session = getSession(options.sessionId);
  if (!session) throw new Error(`Unknown session '${options.sessionId}'`);

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
