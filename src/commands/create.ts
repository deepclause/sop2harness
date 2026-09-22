import path from "node:path";
import { access, cp, mkdir, writeFile } from "node:fs/promises";
import pc from "picocolors";
import { resolveProject } from "../project.js";
import { projectPaths } from "../harness/paths.js";
import { validateHarness } from "../harness/validate.js";
import { ingestSources } from "../authoring/ingest.js";
import { runAuthoringSession, type AuthoringProgress } from "../authoring/session.js";
import { buildAuthoringRequest } from "../authoring/request.js";
import * as ui from "../ui.js";

export interface CreateOptions {
  request?: string;
  files?: string[];
  name?: string;
  update?: boolean;
  model?: string;
  context?: string;
  headless?: boolean;
  json?: boolean;
  debug?: boolean;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function backupSkillsForUpdate(paths: ReturnType<typeof projectPaths>): Promise<void> {
  const skills = path.join(paths.dcDir, "skills");
  if (!(await exists(skills))) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(paths.dcDir, ".backup", ts);
  await mkdir(backupDir, { recursive: true });
  await cp(skills, path.join(backupDir, "skills"), { recursive: true });
  ui.info(`Backed up existing skills to ${path.relative(paths.harnessDir, backupDir)}`);
}

function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;
  const entries = Object.entries(record);
  if (entries.length === 0) return "";
  const parts = entries.slice(0, 4).map(([key, value]) => {
    if (typeof value === "string" && value.length > 80) return `${key}=<${value.length} chars>`;
    const rendered = typeof value === "string" ? value : JSON.stringify(value);
    return `${key}=${rendered.length > 60 ? `${rendered.slice(0, 60)}…` : rendered}`;
  });
  if (entries.length > 4) parts.push("…");
  return parts.join(" ");
}

function createProgressRenderer(debug: boolean): (event: AuthoringProgress) => void {
  return (event) => {
    switch (event.type) {
      case "text":
        process.stdout.write(event.delta);
        break;
      case "thinking":
        if (debug) process.stdout.write(pc.dim(event.delta));
        break;
      case "tool":
        if (event.state === "start") {
          process.stdout.write(`\n${pc.dim("⚙")} ${pc.cyan(event.name)}`);
          const args = summarizeArgs(event.args);
          if (args) process.stdout.write(` ${pc.dim(args)}`);
          process.stdout.write("\n");
        } else {
          process.stdout.write(`${event.isError ? pc.red("✗") : pc.green("✓")} ${pc.cyan(event.name)}${event.isError ? " failed" : ""}\n`);
        }
        break;
      case "notice":
        process.stdout.write(`\n${pc.yellow("!")} ${event.message}\n`);
        break;
    }
  };
}

export async function createCommand(cwd: string, options: CreateOptions): Promise<number> {
  let project;
  try {
    project = await resolveProject(cwd);
  } catch (error) {
    ui.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const paths = project.paths;

  if (!options.request && (!options.files || options.files.length === 0)) {
    ui.error("create needs a request and/or one or more --file inputs.");
    ui.info('Example: s2h create "Turn this SOP into a harness" --file ./procedure.md');
    return 1;
  }

  // 1. Ingest SOP sources (unchanged files are no-ops).
  let sopFiles: string[] = [];
  const warnings: string[] = [];
  if (options.files && options.files.length > 0) {
    const result = await ingestSources(paths, options.files, options.name);
    sopFiles = result.files.map((file) => `sops/${file.file}`);
    warnings.push(...result.warnings);
  }

  for (const warning of warnings) ui.warn(warning);

  if (options.update) {
    await backupSkillsForUpdate(paths);
  }

  // 2. Build the authoring request and run one pi agent turn.
  const authoringRequest = buildAuthoringRequest({
    request: options.request,
    sopFiles,
    name: options.name,
    update: options.update ?? false,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ type: "start", harness: project.config.name, update: options.update ?? false })}\n`);
  } else {
    ui.section(`Authoring harness '${project.config.name}'`);
    ui.info(options.model ? `Model: ${options.model}` : "Model: pi default");
  }

  const onProgress = options.json
    ? (event: AuthoringProgress) => process.stdout.write(`${JSON.stringify(event)}\n`)
    : createProgressRenderer(options.debug ?? false);

  let sessionFile: string | undefined;
  let modelUsed: string | undefined;
  try {
    const result = await runAuthoringSession(paths, authoringRequest, {
      model: options.model,
      interactive: !options.headless,
      onProgress,
    });
    sessionFile = result.sessionFile;
    modelUsed = result.model;
  } catch (error) {
    if (!options.json) process.stdout.write("\n");
    ui.error(`Authoring failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  if (!options.json) process.stdout.write("\n");

  // 3. Deterministic validation gate.
  const report = await validateHarness(paths);
  for (const message of report.warnings) ui.warn(message);
  for (const message of report.errors) ui.error(message);

  if (!report.ok) {
    if (!options.json) ui.info("Files were left in place for inspection; fix and re-run `s2h check`.");
    return 1;
  }

  // 4. Record the authoring session pointer for the next commit.
  await mkdir(paths.sessionsDir, { recursive: true });
  await writeFile(
    path.join(paths.sessionsDir, "last-session.json"),
    `${JSON.stringify({ sessionFile, model: modelUsed, date: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ type: "done", ok: true, sessionFile, model: modelUsed, skillCount: report.manifest?.skills.length ?? 0 })}\n`,
    );
  } else {
    ui.ok(`harness valid (${report.manifest?.skills.length ?? 0} skills)`);
    if (sessionFile) ui.info(`Session: ${path.relative(paths.root, sessionFile)}`);
    ui.info("Next: `s2h list`, then `s2h commit -m \"...\"` to version it.");
  }

  return 0;
}
