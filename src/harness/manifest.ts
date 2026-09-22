import { readFile, writeFile } from "node:fs/promises";
import { isValidSemver } from "./semver.js";

export type ContextMode = "turn" | "branch" | "isolated";

export interface Skill {
  id: string;
  path: string;
  title: string;
  triggers: string[];
  effects: string;
  /** False marks a user-owned skill that create/update must never rewrite. */
  generated?: boolean;
}

export interface SandboxLimits {
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface SandboxConfig {
  provider: "agentvm";
  enabled: boolean;
  network: boolean;
  allow: string[];
  mounts: Record<string, string>;
  persistentRoot: boolean;
  limits: SandboxLimits;
}

export interface RuntimeConfig {
  tools: string[];
  compat: string[];
  context: ContextMode;
  gasLimit: number;
  maxTokens: number;
  streaming: boolean;
  sandbox?: SandboxConfig;
}

export interface JevConfig {
  enabled: boolean;
  model: string;
  apiKeyEnv: string;
}

export interface JudgmentConfig {
  default: string;
  jev: JevConfig;
}

export interface HarnessManifest {
  $schema?: string;
  schemaVersion: number;
  name: string;
  title?: string;
  description?: string;
  version: string;
  createdWith?: Record<string, string>;
  entry?: string | null;
  skills: Skill[];
  runtime: RuntimeConfig;
  judgment: JudgmentConfig;
  docs: string[];
}

export const PHTC_TOOLS = ["read_harness_file", "list_harness_files", "ask_user", "bash", "http_fetch"] as const;
export const COMPAT_TOOLS = ["pi_workspace_list", "pi_bash"] as const;

export const DEFAULT_SANDBOX: SandboxConfig = {
  provider: "agentvm",
  enabled: false,
  network: false,
  allow: [],
  mounts: { "/mnt/harness": "harness:ro" },
  persistentRoot: false,
  limits: { timeoutMs: 120_000, maxOutputBytes: 200_000 },
};

export function defaultManifest(name: string): HarnessManifest {
  return {
    $schema: "https://sop2harness.dev/schema/harness-1.json",
    schemaVersion: 1,
    name,
    title: name,
    description: "",
    version: "0.0.0",
    entry: null,
    skills: [],
    runtime: {
      tools: ["read_harness_file", "list_harness_files", "ask_user"],
      compat: [],
      context: "turn",
      gasLimit: 100_000,
      maxTokens: 16_384,
      streaming: true,
    },
    judgment: {
      default: "llm",
      jev: { enabled: false, model: "jev-latest", apiKeyEnv: "TYPESAFE_API_KEY" },
    },
    docs: ["README.md", "AGENTS.md", "sops/INDEX.md"],
  };
}

export async function loadManifest(path: string): Promise<HarnessManifest> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Manifest not found: ${path}`);
    }
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Manifest must be a JSON object: ${path}`);
  }
  return value as HarnessManifest;
}

export async function writeManifest(path: string, manifest: HarnessManifest): Promise<void> {
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export function assertValidVersion(value: unknown): asserts value is string {
  if (!isValidSemver(value)) {
    throw new Error("harness.json.version must be valid semver");
  }
}
