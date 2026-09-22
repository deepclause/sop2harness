import { readFile } from "node:fs/promises";
import path from "node:path";

export interface Skill {
  id: string;
  path: string;
  title: string;
  triggers: string[];
  effects: string;
  generated?: boolean;
}

export interface SandboxConfig {
  provider: string;
  enabled: boolean;
  network?: boolean;
  allow?: string[];
  limits?: { timeoutMs: number; maxOutputBytes: number };
}

export interface HarnessManifest {
  schemaVersion: number;
  name: string;
  title?: string;
  description?: string;
  version: string;
  entry?: string | null;
  skills: Skill[];
  runtime: {
    tools: string[];
    compat: string[];
    context: "turn" | "branch" | "isolated";
    gasLimit: number;
    maxTokens: number;
    streaming: boolean;
    sandbox?: SandboxConfig;
  };
  judgment?: {
    default: string;
    jev?: { enabled: boolean; model: string; apiKeyEnv: string };
  };
  docs: string[];
}

export function harnessRoot(): string {
  return path.resolve(process.env.S2H_HARNESS_DIR ?? path.join(process.cwd(), "harness"));
}

export async function loadManifest(): Promise<HarnessManifest> {
  const raw = await readFile(path.join(harnessRoot(), "harness.json"), "utf8");
  const value = JSON.parse(raw) as HarnessManifest;
  if (!value || typeof value !== "object" || !Array.isArray(value.skills)) {
    throw new Error("harness.json is not a valid harness manifest");
  }
  return value;
}

export function skillSourcePath(manifest: HarnessManifest, skill: Skill): string {
  return path.join(harnessRoot(), ".pi", "deepclause", skill.path);
}

export async function loadSkillSource(manifest: HarnessManifest, skill: Skill): Promise<string> {
  return readFile(skillSourcePath(manifest, skill), "utf8");
}
