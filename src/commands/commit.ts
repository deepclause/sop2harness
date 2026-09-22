import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolveProject } from "../project.js";
import { validateHarness } from "../harness/validate.js";
import { loadManifest, writeManifest } from "../harness/manifest.js";
import { bumpVersion, isValidSemver, type VersionBump } from "../harness/semver.js";
import * as ui from "../ui.js";

const execFileAsync = promisify(execFile);

export interface CommitOptions {
  message?: string;
  major?: boolean;
  minor?: boolean;
  patch?: boolean;
  tag?: boolean;
  dryRun?: boolean;
}

interface VersionEntry {
  version: string;
  commit: string;
  date: string;
  message: string;
  session?: string;
}

interface VersionsFile {
  versions: VersionEntry[];
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function execGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { cwd });
}

async function isGitRepo(root: string): Promise<boolean> {
  return exists(path.join(root, ".git"));
}

async function tagExists(root: string, tag: string): Promise<boolean> {
  const result = await execGit(["tag", "-l", tag], root);
  return result.stdout.trim().split(/\r?\n/).includes(tag);
}

async function readVersions(p: string): Promise<VersionsFile> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(p, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { versions: [] };
    throw new Error(`Invalid .s2h/versions.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray((value as VersionsFile).versions)) {
    throw new Error("Invalid .s2h/versions.json: expected an object with a versions array");
  }
  return value as VersionsFile;
}

async function readLastSession(paths: Awaited<ReturnType<typeof resolveProject>>["paths"]): Promise<string | undefined> {
  const p = path.join(paths.sessionsDir, "last-session.json");
  try {
    const value = JSON.parse(await readFile(p, "utf8")) as { sessionFile?: string };
    if (typeof value.sessionFile === "string" && value.sessionFile.trim() !== "") {
      return `sessions/${path.basename(value.sessionFile)}`;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function commitCommand(cwd: string, options: CommitOptions): Promise<number> {
  let project;
  try {
    project = await resolveProject(cwd);
  } catch (error) {
    ui.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const { root, paths } = project;

  const selected = [options.major, options.minor, options.patch].filter(Boolean).length;
  if (selected > 1) {
    ui.error("Choose at most one of --major, --minor, or --patch.");
    return 1;
  }
  const bump: VersionBump = options.major ? "major" : options.minor ? "minor" : "patch";

  // Deterministic gate first.
  const report = await validateHarness(paths);
  for (const message of report.warnings) ui.warn(message);
  for (const message of report.errors) ui.error(message);
  if (!report.ok) {
    ui.error("Refusing to commit an invalid harness.");
    return 1;
  }

  let manifest;
  try {
    manifest = await loadManifest(paths.harnessJson);
  } catch (error) {
    ui.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (!isValidSemver(manifest.version)) {
    ui.error(`Invalid harness version: ${manifest.version}`);
    return 1;
  }

  const current = manifest.version;
  const next = bumpVersion(current, bump);
  const tagName = `v${next}`;
  const message = options.message?.trim() || `harness v${next}`;
  const session = await readLastSession(paths);
  const date = new Date().toISOString();

  if (options.dryRun) {
    ui.section("Commit plan");
    ui.info(`  version:       ${current} -> ${next}`);
    ui.info(`  bump:          ${bump}`);
    ui.info(`  message:       ${message}`);
    ui.info(`  tag:           ${options.tag === false ? "(none)" : tagName}`);
    ui.info(`  session:       ${session ?? "(none)"}`);
    return 0;
  }

  if (!(await isGitRepo(root))) {
    ui.error(`Not a git repository (${root}). Run \`s2h init\` first.`);
    return 1;
  }

  if (options.tag !== false && (await tagExists(root, tagName))) {
    ui.error(`Tag ${tagName} already exists; choose a different version bump.`);
    return 1;
  }

  // Bump the manifest, then commit the harness content.
  manifest.version = next;
  await writeManifest(paths.harnessJson, manifest);

  try {
    await execGit(["add", "--", "s2h.json", ".gitignore", "harness"], root);
    await execGit(["commit", "-m", message], root);
  } catch (error) {
    ui.error(`Harness commit failed: ${formatGitError(error)}`);
    return 1;
  }

  let commitHash: string;
  try {
    commitHash = (await execGit(["rev-parse", "HEAD"], root)).stdout.trim();
  } catch (error) {
    ui.error(`Could not read commit hash: ${formatGitError(error)}`);
    return 1;
  }

  if (options.tag !== false) {
    try {
      await execGit(["tag", tagName], root);
    } catch (error) {
      ui.error(`Tagging failed: ${formatGitError(error)}`);
      return 1;
    }
  }

  // Record the version after the content commit so the commit hash is real.
  const versions = await readVersions(paths.versionsJson);
  versions.versions.push({
    version: next,
    commit: commitHash,
    date,
    message,
    ...(session ? { session } : {}),
  });
  await writeFile(paths.versionsJson, `${JSON.stringify(versions, null, 2)}\n`, "utf8");

  try {
    await execGit(["add", "--", ".s2h/versions.json"], root);
    await execGit(["commit", "-m", `record harness version ${next}`], root);
  } catch (error) {
    ui.error(`Recording version failed: ${formatGitError(error)}`);
    return 1;
  }

  ui.ok(`Committed harness v${next}`);
  ui.info(`  commit: ${commitHash}`);
  if (options.tag !== false) ui.info(`  tag:    ${tagName}`);
  ui.info("Next: `s2h status`, then `s2h export --out ./export`.");
  return 0;
}

function formatGitError(error: unknown): string {
  if (error instanceof Error && "stderr" in error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
    return stderr || error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
