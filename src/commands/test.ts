import path from "node:path";
import { access, readFile, readdir } from "node:fs/promises";
import { createDeepClause } from "deepclause-sdk";
import type { DeepClauseSDK, DMLEvent, LLMBackend, LLMBackendMessage, LLMBackendRequest, LLMBackendResponse } from "deepclause-sdk";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { Api, AssistantMessage, Message, Model, Usage } from "@earendil-works/pi-ai";
import { resolveProject } from "../project.js";
import { validateHarness } from "../harness/validate.js";
import { loadManifest, type Skill } from "../harness/manifest.js";
import { realpath } from "node:fs/promises";
import * as ui from "../ui.js";

export interface TestOptions {
  skill?: string;
  input?: string;
  mock?: boolean;
  live?: boolean;
  noRun?: boolean;
  diagrams?: boolean;
  json?: boolean;
  model?: string;
}

interface DiagramReport {
  skill: string;
  presentation: { exists: boolean; ok: boolean; issues: string[] };
  specification: { exists: boolean; ok: boolean; issues: string[] };
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolveInside(root: string, relPath: string): Promise<string> {
  const absolute = path.resolve(root, relPath);
  if (!isInside(root, absolute)) throw new Error(`Path escapes root: ${relPath}`);
  const [realRoot, realChild] = await Promise.all([realpath(root), realpath(absolute)]);
  if (!isInside(realRoot, realChild)) throw new Error(`Path escapes root through symlink: ${relPath}`);
  return realChild;
}

function skillBase(skill: Skill): string {
  const rel = skill.path.replaceAll(path.sep, "/");
  return rel.split("/").pop()?.replace(/\.dml$/, "") ?? skill.id;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function validateMermaidLight(content: string): string[] {
  const issues: string[] = [];
  const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    issues.push("empty file");
    return issues;
  }
  const first = lines.find((line) => !line.startsWith("%%"));
  if (!first) {
    issues.push("no diagram body (only comments)");
  } else if (!/^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie)\b/i.test(first)) {
    issues.push(`unrecognized diagram type: ${first.split(" ")[0]}`);
  }

  const pairs: Array<[string, string]> = [["{", "}"], ["[", "]"], ["(", ")"]];
  for (const [open, close] of pairs) {
    const opens = (content.match(new RegExp(`\\${open}`, "g")) ?? []).length;
    const closes = (content.match(new RegExp(`\\${close}`, "g")) ?? []).length;
    if (opens !== closes) issues.push(`unbalanced ${open}${close} (${opens}/${closes})`);
  }
  return issues;
}

async function inspectDiagrams(harnessDir: string, skills: Skill[]): Promise<DiagramReport[]> {
  const diagramsDir = path.join(harnessDir, ".pi", "deepclause", "diagrams");
  return Promise.all(
    skills.map(async (skill) => {
      const base = skillBase(skill);
      const grades = {
        presentation: path.join(diagramsDir, `${base}.presentation.mmd`),
        specification: path.join(diagramsDir, `${base}.specification.mmd`),
      };
      const report: DiagramReport = {
        skill: skill.id,
        presentation: { exists: false, ok: false, issues: [] },
        specification: { exists: false, ok: false, issues: [] },
      };
      for (const grade of ["presentation", "specification"] as const) {
        const file = grades[grade];
        if (!(await exists(file))) continue;
        report[grade].exists = true;
        let content = "";
        try {
          content = await readFile(file, "utf8");
        } catch {
          report[grade].issues.push("unreadable");
          continue;
        }
        report[grade].issues = validateMermaidLight(content);
        report[grade].ok = report[grade].issues.length === 0;
      }
      return report;
    }),
  );
}

function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

function toPiMessages(messages: LLMBackendMessage[], model: Model<Api>): Message[] {
  return messages
    .filter((message) => message.role !== "system")
    .map((message): Message => {
      if (message.role === "assistant" && message.providerData) return message.providerData as AssistantMessage;
      if (message.role === "user") return { role: "user", content: message.content, timestamp: Date.now() };
      if (message.role === "tool") {
        return { role: "toolResult", toolCallId: message.toolCallId ?? "unknown", toolName: message.toolName ?? "unknown", content: [{ type: "text", text: message.content }], isError: false, timestamp: Date.now() };
      }
      return {
        role: "assistant",
        content: [
          ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
          ...(message.toolCalls ?? []).map((call) => ({ type: "toolCall" as const, id: call.id, name: call.name, arguments: call.arguments })),
        ],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: emptyUsage(),
        stopReason: message.toolCalls?.length ? ("toolUse" as const) : ("stop" as const),
        timestamp: Date.now(),
      };
    });
}

function createMockBackend(): LLMBackend {
  return {
    async complete(request: LLMBackendRequest): Promise<LLMBackendResponse> {
      request.onText?.("mock");
      return { text: "mock", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
    },
  };
}

function createPiBackend(providerId: string, modelId: string): LLMBackend {
  const models = builtinModels();
  const model = models.getModel(providerId, modelId) ?? models.getModel("deepseek", "deepseek-v4-pro");
  if (!model) throw new Error(`No pi model found for ${providerId}/${modelId}`);
  return {
    async complete(request: LLMBackendRequest): Promise<LLMBackendResponse> {
      const systemPrompt = request.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const response = await models.completeSimple(
        model,
        {
          systemPrompt: systemPrompt || undefined,
          messages: toPiMessages(request.messages, model),
          tools: request.tools?.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters as never })),
        },
        { signal: request.signal, maxTokens: request.maxTokens ?? 4096, cacheRetention: "none" },
      );
      if (response.stopReason === "error" || response.stopReason === "aborted") {
        throw new Error(response.errorMessage || `pi model request ${response.stopReason}`);
      }
      const text = response.content.filter((c): c is Extract<AssistantMessage["content"][number], { type: "text" }> => c.type === "text").map((c) => c.text).join("");
      if (text) request.onText?.(text);
      return {
        text,
        toolCalls: response.content.filter((c): c is Extract<AssistantMessage["content"][number], { type: "toolCall" }> => c.type === "toolCall").map((c) => ({ id: c.id, name: c.name, arguments: c.arguments })),
        usage: { inputTokens: response.usage.input, outputTokens: response.usage.output, totalTokens: response.usage.totalTokens, cacheReadTokens: response.usage.cacheRead, cacheWriteTokens: response.usage.cacheWrite, reasoningTokens: response.usage.reasoning },
        finishReason: response.stopReason === "toolUse" ? "tool_use" : response.stopReason === "length" ? "length" : response.stopReason === "stop" ? "stop" : undefined,
        providerData: response,
      };
    },
  };
}

async function createSdk(backend: LLMBackend, manifest: Awaited<ReturnType<typeof loadManifest>>, harnessDir: string): Promise<DeepClauseSDK> {
  const sdk = await createDeepClause({
    model: process.env.S2H_LLM_MODEL?.trim() || "deepseek-v4-pro",
    maxTokens: manifest.runtime.maxTokens,
    streaming: true,
    llmBackend: backend,
  });
  if (manifest.runtime.tools.includes("read_harness_file")) {
    sdk.registerTool("read_harness_file", {
      description: "Read a UTF-8 file inside the harness root.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      execute: async (args) => {
        const rel = typeof args.path === "string" ? args.path : "";
        const file = await resolveInside(harnessDir, rel);
        return { content: await readFile(file, "utf8") };
      },
    });
  }
  if (manifest.runtime.tools.includes("list_harness_files")) {
    sdk.registerTool("list_harness_files", {
      description: "List one directory level inside the harness root.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      execute: async (args) => {
        const rel = typeof args.path === "string" ? args.path : ".";
        const dir = await resolveInside(harnessDir, rel);
        return { entries: (await readdir(dir)).sort() };
      },
    });
  }
  return sdk;
}

async function runOne(sdk: DeepClauseSDK, harnessDir: string, skill: Skill, input: string, gasLimit: number): Promise<string> {
  const source = await readFile(path.join(harnessDir, ".pi", "deepclause", skill.path), "utf8");
  let answer = "";
  let lastError = "";
  for await (const event of sdk.runDML(source, { args: [input], workspacePath: harnessDir, gasLimit })) {
    if (event.type === "answer" && event.content) answer = event.content;
    if (event.type === "error" && event.content) lastError = event.content;
  }
  return answer || lastError || "(no answer)";
}

export async function testCommand(cwd: string, options: TestOptions): Promise<number> {
  let project;
  try {
    project = await resolveProject(cwd);
  } catch (error) {
    ui.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const { root, paths } = project;

  const report = await validateHarness(paths);
  for (const message of report.warnings) ui.warn(message);
  for (const message of report.errors) ui.error(message);
  if (!report.ok) {
    ui.error("Harness is invalid; fix the errors above before testing.");
    return 1;
  }

  const manifest = await loadManifest(paths.harnessJson);
  const skills = options.skill ? manifest.skills.filter((skill) => skill.id === options.skill) : manifest.skills;
  if (skills.length === 0) {
    ui.error(options.skill ? `Unknown skill '${options.skill}'` : "No skills to test.");
    return 1;
  }

  // Diagram inspection.
  ui.section("Diagrams");
  const diagramReports = await inspectDiagrams(paths.harnessDir, skills);
  for (const diagram of diagramReports) {
    const present = diagram.presentation.exists ? (diagram.presentation.ok ? "✓" : "✗") : "·";
    const spec = diagram.specification.exists ? (diagram.specification.ok ? "✓" : "✗") : "·";
    ui.info(`  ${present} presentation  ${spec} specification  ${diagram.skill}`);
    for (const grade of ["presentation", "specification"] as const) {
      for (const issue of diagram[grade].issues) ui.warn(`      ${grade}: ${issue}`);
    }
  }

  if (options.noRun) return 0;

  // Smoke run each skill with its first trigger (or the supplied input).
  ui.section("Smoke runs");
  const useLive = options.live === true && options.mock !== true;
  let backend: LLMBackend;
  if (options.mock || !useLive) {
    if (!options.mock) ui.warn("Using the mock backend; pass --live to use a real pi model.");
    backend = createMockBackend();
  } else {
    let providerId = "deepseek";
    let modelId = "deepseek-v4-pro";
    if (options.model) {
      const [provider, model] = options.model.split("/");
      if (provider && model) { providerId = provider; modelId = model; }
    }
    backend = createPiBackend(providerId, modelId);
  }

  const sdk = await createSdk(backend, manifest, paths.harnessDir);
  let failed = 0;
  for (const skill of skills) {
    const input = options.input ?? skill.triggers[0] ?? `run ${skill.id}`;
    try {
      const answer = await runOne(sdk, paths.harnessDir, skill, input, manifest.runtime.gasLimit);
      ui.ok(`${skill.id}: ${answer}`);
    } catch (error) {
      failed += 1;
      ui.error(`${skill.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return failed === 0 ? 0 : 1;
}
