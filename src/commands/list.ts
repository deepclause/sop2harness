import path from "node:path";
import { access, readFile, readdir } from "node:fs/promises";
import { resolveProject } from "../project.js";
import { loadManifest } from "../harness/manifest.js";
import * as ui from "../ui.js";

interface VersionEntry {
  version: string;
  commit?: string;
  date?: string;
  message?: string;
  session?: string;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function listSopFiles(dir: string): Promise<string[]> {
  const result: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return result;
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await listSopFiles(full)));
    } else if (entry.isFile()) {
      result.push(full);
    }
  }
  return result.sort();
}

export async function listCommand(cwd: string, opts: { json?: boolean }): Promise<number> {
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

  const sops = (await listSopFiles(project.paths.sopsDir))
    .map((file) => path.relative(project.paths.harnessDir, file).replaceAll(path.sep, "/"))
    .filter((file) => file !== "sops/INDEX.md");

  let versions: VersionEntry[] = [];
  if (await exists(project.paths.versionsJson)) {
    try {
      const parsed = JSON.parse(await readFile(project.paths.versionsJson, "utf8")) as {
        versions?: VersionEntry[];
      };
      versions = Array.isArray(parsed.versions) ? parsed.versions : [];
    } catch (error) {
      ui.warn(`Could not read .s2h/versions.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          name: manifest.name,
          version: manifest.version,
          skills: manifest.skills.map((skill) => ({
            id: skill.id,
            title: skill.title,
            triggers: skill.triggers,
            effects: skill.effects,
            path: skill.path,
          })),
          sops,
          versions,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  ui.section(`Skills (${manifest.skills.length})`);
  if (manifest.skills.length === 0) {
    ui.info("  (none)");
  } else {
    for (const skill of manifest.skills) {
      ui.info(`  ${skill.id}`);
      ui.info(`    title:    ${skill.title}`);
      ui.info(`    triggers: ${skill.triggers.join(", ")}`);
      ui.info(`    effects:  ${skill.effects}`);
      ui.info(`    path:     ${skill.path}`);
    }
  }

  ui.section(`SOPs (${sops.length})`);
  if (sops.length === 0) {
    ui.info("  (none)");
  } else {
    for (const file of sops) ui.info(`  ${file}`);
  }

  ui.section(`Versions (${versions.length})`);
  if (versions.length === 0) {
    ui.info("  (none committed)");
  } else {
    for (const entry of versions) {
      ui.info(`  ${entry.version}${entry.commit ? `  ${entry.commit}` : ""}${entry.message ? `  ${entry.message}` : ""}`);
    }
  }

  return 0;
}
