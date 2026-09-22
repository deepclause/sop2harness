import path from "node:path";
import { access, readFile } from "node:fs/promises";
import { projectPaths, type ProjectPaths } from "./harness/paths.js";

export interface ProjectConfig {
  name: string;
  /** Model in `provider/id` form, or null to use pi's default. */
  model: string | null;
  /** Harness directory name, relative to the project root. */
  harnessDir: string;
}

export function defaultProjectConfig(name: string): ProjectConfig {
  return { name, model: null, harnessDir: "harness" };
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "harness";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loadProjectConfig(root: string): Promise<ProjectConfig> {
  const fallback = defaultProjectConfig(slugify(path.basename(root)));
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path.join(root, "s2h.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw new Error(`Invalid s2h.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(value)) throw new Error("s2h.json must be a JSON object");

  const name = typeof value.name === "string" && value.name.trim() !== "" ? value.name.trim() : fallback.name;
  const model = typeof value.model === "string" && value.model.trim() !== "" ? value.model.trim() : null;
  const harnessDir =
    typeof value.harnessDir === "string" && value.harnessDir.trim() !== "" ? value.harnessDir.trim() : "harness";
  return { name, model, harnessDir };
}

/** Walk up from `start` to find an s2h project root. */
export async function findProjectRoot(start: string): Promise<string | null> {
  let dir = path.resolve(start);
  for (;;) {
    const root = dir;
    if (await fileExists(path.join(root, "s2h.json"))) return root;
    if (await fileExists(path.join(root, "harness", "harness.json"))) return root;
    const parent = path.dirname(root);
    if (parent === root) return null;
    dir = parent;
  }
}

export async function resolveProject(start: string): Promise<{ root: string; paths: ProjectPaths; config: ProjectConfig }> {
  const root = await findProjectRoot(start);
  if (!root) {
    throw new Error("No s2h project found here (or in any parent directory). Run `s2h init` first.");
  }
  const config = await loadProjectConfig(root);
  const harnessDir = path.resolve(root, config.harnessDir);
  const paths = projectPaths(root);
  // projectPaths currently assumes the default "harness" directory; validate that assumption.
  if (path.normalize(paths.harnessDir) !== path.normalize(harnessDir)) {
    throw new Error(`Custom harnessDir is not supported yet in this phase (found '${config.harnessDir}')`);
  }
  return { root, paths, config };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
