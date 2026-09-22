import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, readFile } from "node:fs/promises";
import { resolveProject } from "../project.js";
import { loadManifest } from "../harness/manifest.js";
import * as ui from "../ui.js";

const execFileAsync = promisify(execFile);

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function gitInfo(root: string): Promise<{ branch: string | null; dirty: boolean; isRepo: boolean }> {
  let branch = null;
  let dirty = false;
  try {
    const branchResult = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root });
    branch = branchResult.stdout.trim() || null;
  } catch {
    // A fresh repository has no HEAD yet; that is still a git repo.
    branch = null;
  }
  try {
    const statusResult = await execFileAsync("git", ["status", "--porcelain"], { cwd: root });
    dirty = statusResult.stdout.trim().length > 0;
    return { branch, dirty, isRepo: true };
  } catch {
    return { branch: null, dirty: false, isRepo: false };
  }
}

export async function statusCommand(cwd: string, opts: { json?: boolean }): Promise<number> {
  let project;
  try {
    project = await resolveProject(cwd);
  } catch (error) {
    ui.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  let manifest;
  try {
    manifest = await loadManifest(project.paths.harnessJson);
  } catch (error) {
    ui.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const git = await gitInfo(project.root);

  let lastVersion: { version: string; commit?: string; date?: string; message?: string } | null = null;
  if (await exists(project.paths.versionsJson)) {
    try {
      const parsed = JSON.parse(await readFile(project.paths.versionsJson, "utf8")) as {
        versions?: Array<{ version: string; commit?: string; date?: string; message?: string }>;
      };
      if (Array.isArray(parsed.versions) && parsed.versions.length > 0) {
        lastVersion = parsed.versions[parsed.versions.length - 1]!;
      }
    } catch {
      lastVersion = null;
    }
  }

  const state = {
    project: project.config.name,
    root: project.root,
    harnessDir: path.relative(project.root, project.paths.harnessDir),
    harnessVersion: manifest.version,
    skillCount: manifest.skills.length,
    model: project.config.model,
    git: git.isRepo
      ? { branch: git.branch, dirty: git.dirty }
      : { branch: null, dirty: false, notRepository: true },
    lastVersion,
  };

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    return 0;
  }

  ui.section("Project");
  ui.info(`  name:            ${state.project}`);
  ui.info(`  root:            ${state.root}`);
  ui.info(`  harness dir:     ${state.harnessDir}`);
  ui.info(`  model:           ${state.model ?? "(pi default)"}`);

  ui.section("Harness");
  ui.info(`  version:         ${state.harnessVersion}`);
  ui.info(`  skills:          ${state.skillCount}`);

  ui.section("Git");
  if (!git.isRepo) {
    ui.info("  not a git repository");
  } else {
    ui.info(`  branch:          ${git.branch ?? "(no commits yet)"}`);
    ui.info(`  working tree:    ${git.dirty ? "dirty" : "clean"}`);
  }

  ui.section("Versions");
  ui.info(
    lastVersion
      ? `  last committed:  ${lastVersion.version}${lastVersion.commit ? ` (${lastVersion.commit})` : ""}`
      : "  none committed",
  );

  return 0;
}
