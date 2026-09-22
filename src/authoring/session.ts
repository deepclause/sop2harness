import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import pc from "picocolors";
import { Type } from "@earendil-works/pi-ai";
import {
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
  resolveCliModel,
} from "@earendil-works/pi-coding-agent";
import type { ProjectPaths } from "../harness/paths.js";

const require = createRequire(import.meta.url);

export type AuthoringProgress =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool"; name: string; state: "start" | "end"; args?: unknown; isError?: boolean }
  | { type: "notice"; message: string };

export interface AuthoringOptions {
  /** `provider/id` model override. */
  model?: string;
  /** When false, clarification questions are auto-answered for CI. */
  interactive?: boolean;
  /** Progress callback for text deltas and tool activity. */
  onProgress?: (event: AuthoringProgress) => void;
}

export interface AuthoringResult {
  sessionFile?: string;
  model?: string;
}

function deepClausePiDir(): string {
  return path.dirname(require.resolve("deepclause-pi/package.json"));
}

function s2hSkillsDir(): string {
  return fileURLToPath(new URL("../../skills/", import.meta.url));
}

async function readDeepClausePiManifest(): Promise<{ extensions: string[]; skills: string[] }> {
  const pkg = JSON.parse(
    await readFile(path.join(deepClausePiDir(), "package.json"), "utf8"),
  ) as { pi?: { extensions?: string[]; skills?: string[] } };
  return {
    extensions: pkg.pi?.extensions ?? [],
    skills: pkg.pi?.skills ?? [],
  };
}

function promptUser(question: string, options: string[]): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.resolve("proceed with defaults (non-interactive)");
  }

  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write(`\n${pc.yellow("?")} ${question}\n`);
    if (options.length > 0) {
      process.stdout.write(`${options.map((option, index) => `  ${pc.dim(`${index + 1}.`)} ${option}`).join("\n")}\n`);
    }
    rl.question(`${pc.cyan(">")} `, (answer) => {
      rl.close();
      resolve(answer.trim() || options[0] || "continue");
    });
  });
}

function clarificationTool(interactive: boolean) {
  return defineTool({
    name: "s2h_ask_user",
    label: "Ask user",
    description:
      "Ask the user one focused clarification question during harness authoring. Use for scope, decomposition, or tool choices. Returns the user's answer.",
    parameters: Type.Object({
      question: Type.String({ description: "The question to ask the user" }),
      options: Type.Optional(Type.Array(Type.String(), { description: "Optional suggested answers" })),
    }),
    execute: async (_toolCallId, params) => {
      const question = String(params.question ?? "");
      const options = Array.isArray(params.options) ? params.options.map((value) => String(value)) : [];
      const answer = interactive ? await promptUser(question, options) : "proceed with defaults (headless)";
      return {
        content: [{ type: "text", text: answer }],
        details: { question, options, answer },
      };
    },
  });
}

/**
 * Run one pi agent turn with `deepclause-pi` and the bundled `s2h-authoring`
 * skill loaded, using `harness/` as the working directory. The agent is
 * allowed read/write/edit/grep/find/ls plus the `s2h_ask_user` clarification
 * tool (no bash).
 */
export async function runAuthoringSession(
  paths: ProjectPaths,
  request: string,
  options: AuthoringOptions = {},
): Promise<AuthoringResult> {
  const piManifest = await readDeepClausePiManifest();
  const piDir = deepClausePiDir();

  const modelRuntime = await ModelRuntime.create();
  let model: ReturnType<typeof resolveCliModel>["model"];
  const notices: string[] = [];

  if (options.model) {
    const resolved = resolveCliModel({ cliModel: options.model, modelRuntime });
    if (resolved.error) throw new Error(resolved.error);
    if (resolved.warning) notices.push(resolved.warning);
    model = resolved.model;
  }

  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });

  const loader = new DefaultResourceLoader({
    cwd: paths.harnessDir,
    agentDir: getAgentDir(),
    settingsManager,
    additionalExtensionPaths: piManifest.extensions.map((rel) => path.join(piDir, rel)),
    additionalSkillPaths: [...piManifest.skills.map((rel) => path.join(piDir, rel)), s2hSkillsDir()],
  });
  await loader.reload();

  const sessionManager = SessionManager.create(paths.harnessDir, path.join(paths.root, ".s2h", "sessions"));

  const createOptions = {
    cwd: paths.harnessDir,
    agentDir: getAgentDir(),
    modelRuntime,
    settingsManager,
    resourceLoader: loader,
    sessionManager,
    tools: ["read", "write", "edit", "grep", "find", "ls", "s2h_ask_user"],
    customTools: [clarificationTool(options.interactive ?? true)],
    ...(model ? { model } : {}),
  };

  const { session } = await createAgentSession(createOptions);

  try {
    session.subscribe((event) => {
      switch (event.type) {
        case "message_update": {
          const update = event.assistantMessageEvent;
          if (update.type === "text_delta") {
            options.onProgress?.({ type: "text", delta: update.delta });
          } else if (update.type === "thinking_delta") {
            options.onProgress?.({ type: "thinking", delta: update.delta });
          }
          break;
        }
        case "tool_execution_start":
          options.onProgress?.({ type: "tool", name: event.toolName, state: "start", args: event.args });
          break;
        case "tool_execution_end":
          options.onProgress?.({ type: "tool", name: event.toolName, state: "end", isError: event.isError });
          break;
        default:
          break;
      }
    });

    for (const notice of notices) options.onProgress?.({ type: "notice", message: notice });

    await session.prompt(request);

    const modelUsed = session.model ? `${String(session.model.provider)}/${String(session.model.id)}` : undefined;
    return { sessionFile: session.sessionFile, model: modelUsed };
  } finally {
    session.dispose();
  }
}
