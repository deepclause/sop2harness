import path from "node:path";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { validateWithProlog } from "deepclause-sdk/compiler";
import type { HarnessManifest, Skill } from "./manifest.js";
import { loadManifest, COMPAT_TOOLS } from "./manifest.js";
import { parseRouterFile } from "./router.js";
import { isValidSemver } from "./semver.js";
import { isInside, resolveExistingInside } from "./confine.js";
import type { ProjectPaths } from "./paths.js";

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifest?: HarnessManifest;
}

type Record = { [key: string]: unknown };

function isRecord(value: unknown): value is Record {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

async function collectDmlFiles(dir: string): Promise<string[]> {
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
      result.push(...(await collectDmlFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".dml")) {
      result.push(full);
    }
  }
  return result;
}

function normalizeEffects(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeRelativePath(value: string): string {
  return value.replaceAll(path.sep, "/");
}

const FALLBACK_CLAUSE_RE = /agent_main\s*\(\s*_\s*\)\s*:-/;

export async function validateHarness(paths: ProjectPaths): Promise<ValidationReport> {
  const errors: string[] = [];
  const warnings: string[] = [];

  let manifest: HarnessManifest;
  try {
    manifest = await loadManifest(paths.harnessJson);
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
      warnings,
    };
  }

  // --- Top-level shape ---------------------------------------------------
  if (manifest.schemaVersion !== 1) {
    errors.push(`harness.json.schemaVersion must be 1 (got ${JSON.stringify(manifest.schemaVersion)})`);
  }
  if (typeof manifest.name !== "string" || manifest.name.trim() === "") {
    errors.push("harness.json.name must be a non-empty string");
  }
  if (!isValidSemver(manifest.version)) {
    errors.push(`harness.json.version must be valid semver (got ${JSON.stringify(manifest.version)})`);
  }
  if (!Array.isArray(manifest.skills)) {
    errors.push("harness.json.skills must be an array");
    return { ok: false, errors, warnings, manifest };
  }

  const skills = manifest.skills as Skill[];
  const skillIds = new Set<string>();
  for (const [index, skill] of skills.entries()) {
    const at = `harness.json.skills[${index}]`;
    if (!isRecord(skill)) {
      errors.push(`${at} must be an object`);
      continue;
    }
    if (typeof skill.id !== "string" || skill.id.trim() === "") {
      errors.push(`${at}.id must be a non-empty string`);
    } else if (skillIds.has(skill.id)) {
      errors.push(`${at}.id duplicates skill id '${skill.id}'`);
    } else {
      skillIds.add(skill.id);
    }
    if (typeof skill.path !== "string" || skill.path.trim() === "") {
      errors.push(`${at}.path must be a non-empty string`);
    }
    if (typeof skill.title !== "string" || skill.title.trim() === "") {
      errors.push(`${at}.title must be a non-empty string`);
    }
    if (!isStringArray(skill.triggers)) {
      errors.push(`${at}.triggers must be an array of strings`);
    }
    if (skill.effects !== undefined && typeof skill.effects !== "string") {
      errors.push(`${at}.effects must be a string`);
    }
  }

  // --- Skills resolve to real .dml files ---------------------------------
  for (const skill of skills) {
    if (typeof skill.path !== "string" || skill.path.trim() === "") continue;
    const abs = path.resolve(paths.dcDir, skill.path);
    if (!isInside(paths.dcDir, abs)) {
      errors.push(`Skill '${skill.id}' path escapes .pi/deepclause/: ${skill.path}`);
      continue;
    }
    if (!skill.path.endsWith(".dml")) {
      errors.push(`Skill '${skill.id}' path must end in .dml: ${skill.path}`);
      continue;
    }
    if (!(await isFile(abs))) {
      errors.push(`Skill '${skill.id}' file not found: ${skill.path}`);
      continue;
    }
    try {
      await resolveExistingInside(paths.dcDir, skill.path);
    } catch (error) {
      errors.push(`Skill '${skill.id}' path is not confined: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // --- Entry point ---------------------------------------------------------
  const entry = manifest.entry ?? null;
  if (entry !== null) {
    if (typeof entry !== "string" || entry.trim() === "") {
      errors.push("harness.json.entry must be a skill id or null");
    } else if (!skillIds.has(entry)) {
      errors.push(`harness.json.entry references unknown skill '${entry}'`);
    }
  }

  // --- Triggers for routable skills ---------------------------------------
  const routableSkills = skills.filter((skill) => typeof skill.id === "string" && skill.id !== entry);
  for (const skill of routableSkills) {
    if (!isStringArray(skill.triggers) || skill.triggers.length === 0) {
      errors.push(`Skill '${skill.id}' is routable and must declare at least one trigger`);
    }
  }

  // --- Runtime -------------------------------------------------------------
  const runtime = manifest.runtime;
  if (!isRecord(runtime)) {
    errors.push("harness.json.runtime must be an object");
  } else {
    if (!isStringArray(runtime.tools)) {
      errors.push("harness.json.runtime.tools must be an array of strings");
    } else {
      for (const tool of runtime.tools) {
        if (tool === "pi_bash" || tool === "pi_workspace_list") {
          errors.push(`harness.json.runtime.tools uses compat name '${tool}'; declare it in runtime.compat instead`);
        }
        if (tool === "bash" && !(runtime.sandbox && runtime.sandbox.enabled)) {
          errors.push("harness.json declares 'bash' but runtime.sandbox.enabled is not true");
        }
      }
    }
    if (runtime.compat !== undefined && !isStringArray(runtime.compat)) {
      errors.push("harness.json.runtime.compat must be an array of strings");
    } else if (Array.isArray(runtime.compat)) {
      for (const tool of runtime.compat) {
        if (!(COMPAT_TOOLS as readonly string[]).includes(tool)) {
          errors.push(`harness.json.runtime.compat has unknown compat tool '${tool}'`);
        }
        if (tool === "pi_bash" && !(runtime.sandbox && runtime.sandbox.enabled)) {
          errors.push("harness.json declares 'pi_bash' but runtime.sandbox.enabled is not true");
        }
      }
    }
    if (runtime.context !== undefined && !["turn", "branch", "isolated"].includes(runtime.context as string)) {
      errors.push("harness.json.runtime.context must be turn, branch, or isolated");
    }
    if (runtime.gasLimit !== undefined && (!Number.isInteger(runtime.gasLimit) || Number(runtime.gasLimit) <= 0)) {
      errors.push("harness.json.runtime.gasLimit must be a positive integer");
    }
    if (runtime.maxTokens !== undefined && (!Number.isInteger(runtime.maxTokens) || Number(runtime.maxTokens) <= 0)) {
      errors.push("harness.json.runtime.maxTokens must be a positive integer");
    }
    if (runtime.streaming !== undefined && typeof runtime.streaming !== "boolean") {
      errors.push("harness.json.runtime.streaming must be a boolean");
    }
    if (runtime.sandbox !== undefined) {
      if (!isRecord(runtime.sandbox)) {
        errors.push("harness.json.runtime.sandbox must be an object");
      } else {
        if (runtime.sandbox.enabled === true && runtime.sandbox.provider !== "agentvm") {
          errors.push("harness.json.runtime.sandbox.provider must be 'agentvm' when enabled");
        }
        if (runtime.sandbox.enabled === true && typeof runtime.sandbox.network !== "boolean") {
          errors.push("harness.json.runtime.sandbox.network must be a boolean");
        }
        if (runtime.sandbox.allow !== undefined && !isStringArray(runtime.sandbox.allow)) {
          errors.push("harness.json.runtime.sandbox.allow must be an array of strings");
        }
        const limits = runtime.sandbox.limits;
        if (limits !== undefined) {
          if (!isRecord(limits) ||
              !Number.isInteger(limits.timeoutMs) || Number(limits.timeoutMs) <= 0 ||
              !Number.isInteger(limits.maxOutputBytes) || Number(limits.maxOutputBytes) <= 0) {
            errors.push("harness.json.runtime.sandbox.limits must set positive timeoutMs and maxOutputBytes");
          }
        }
      }
    }
  }

  // --- Judgment -------------------------------------------------------------
  if (manifest.judgment !== undefined) {
    const judgment = manifest.judgment;
    if (!isRecord(judgment)) {
      errors.push("harness.json.judgment must be an object");
    } else {
      if (typeof judgment.default !== "string" || judgment.default.trim() === "") {
        errors.push("harness.json.judgment.default must be a non-empty string");
      }
      if (judgment.jev !== undefined && !isRecord(judgment.jev)) {
        errors.push("harness.json.judgment.jev must be an object");
      }
    }
  }

  // --- Docs ------------------------------------------------------------------
  if (!Array.isArray(manifest.docs)) {
    errors.push("harness.json.docs must be an array of strings");
  } else {
    for (const doc of manifest.docs) {
      if (typeof doc !== "string" || doc.trim() === "") {
        errors.push("harness.json.docs entries must be non-empty strings");
        continue;
      }
      try {
        await resolveExistingInside(paths.harnessDir, doc);
      } catch (error) {
        errors.push(`harness.json.docs path '${doc}' is invalid: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // --- Router agreement ------------------------------------------------------
  const rows = await parseRouterFile(paths.agentsMd);
  const rowById = new Map<string, string>();
  for (const row of rows) {
    if (rowById.has(row.skillId)) {
      errors.push(`AGENTS.md has more than one routing row for skill '${row.skillId}'`);
    }
    rowById.set(row.skillId, row.effects);
  }
  const routableIds = new Set(routableSkills.map((skill) => skill.id));
  for (const skill of routableSkills) {
    if (!rowById.has(skill.id)) {
      errors.push(`AGENTS.md is missing a routing row for skill '${skill.id}'`);
    }
  }
  for (const id of rowById.keys()) {
    if (!routableIds.has(id)) {
      errors.push(`AGENTS.md routes skill '${id}', which is not a routable skill in harness.json`);
    }
  }
  for (const skill of routableSkills) {
    const effects = rowById.get(skill.id);
    const manifestEffects = typeof skill.effects === "string" ? skill.effects : "none";
    if (effects !== undefined && normalizeEffects(effects) !== normalizeEffects(manifestEffects)) {
      errors.push(
        `AGENTS.md effects for '${skill.id}' ('${effects}') do not match harness.json ('${manifestEffects}')`,
      );
    }
  }

  // --- Reject the forbidden workspace name -----------------------------------
  if (await exists(path.join(paths.harnessDir, ".deepclause"))) {
    errors.push("harness/.deepclause/ exists; the DeepClause workspace must live at harness/.pi/deepclause/");
  }

  // --- DML parse + fallback --------------------------------------------------
  const skillByPath = new Map<string, Skill>();
  for (const skill of skills) {
    if (typeof skill.id === "string" && typeof skill.path === "string") {
      skillByPath.set(normalizeRelativePath(skill.path), skill);
    }
  }
  const dmlFiles = await collectDmlFiles(paths.dcSkillsDir);
  for (const file of dmlFiles) {
    const rel = path.relative(paths.harnessDir, file);
    let source: string;
    try {
      source = await readFile(file, "utf8");
    } catch (error) {
      errors.push(`Cannot read DML file ${rel}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const parsed = await validateWithProlog(source);
    if (!parsed.valid) {
      errors.push(`DML file ${rel} does not parse: ${(parsed.errors ?? []).join("; ")}`);
    }
    // The static fallback clause requirement applies only to harness skills,
    // not to authoring library files that happen to live under skills/.
    const skillRel = normalizeRelativePath(path.relative(paths.dcDir, file));
    const skill = skillByPath.get(skillRel);
    if (skill && !FALLBACK_CLAUSE_RE.test(source)) {
      errors.push(`Skill '${skill.id}' is missing a static fallback clause agent_main(_) :- ...`);
    }
  }

  // Surface helpful non-fatal notes.
  if (skills.length === 0) {
    warnings.push("harness has no skills yet; run `s2h create` to author procedures from SOPs");
  }
  for (const skill of skills) {
    if (typeof skill.effects === "string" && skill.effects !== "none") {
      warnings.push(`skill '${skill.id}' declares effects; exporting it will require --allow-effects`);
    }
  }

  return { ok: errors.length === 0, errors, warnings, manifest };
}
