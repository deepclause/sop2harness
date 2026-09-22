import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { ProjectPaths } from "../harness/paths.js";

const require = createRequire(import.meta.url);

const TEMPLATE_DIR = fileURLToPath(new URL("../../templates/init/", import.meta.url));

/**
 * deepclause-pi's workspace config defaults. Mirrored here (not imported) so
 * `s2h init` can seed `.pi/deepclause/config.json` without loading the pi
 * extension, which is not consumable as a plain ES module.
 */
export const DEEPCLAUSE_DEFAULT_CONFIG = {
  version: 1,
  contextMode: "turn",
  branchMessageLimit: 20,
  gasLimit: 100_000,
  maxTokens: 16_384,
  verbose: false,
  modelToolEnabled: false,
  judgment: {
    default: "llm",
    jev: { enabled: false, model: "jev-latest", apiKeyEnv: "TYPESAFE_API_KEY" },
  },
} as const;

function piPackageDir(): string {
  return path.dirname(require.resolve("deepclause-pi/package.json"));
}

function sdkPackageDir(): string {
  // `deepclause-sdk` resolves to <pkg>/dist/index.js under its exports map.
  return path.dirname(path.dirname(fileURLToPath(import.meta.resolve("deepclause-sdk"))));
}

async function writeIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

async function readTemplate(name: string): Promise<string> {
  return readFile(path.join(TEMPLATE_DIR, name), "utf8");
}

/**
 * Seed `harness/.pi/deepclause/` exactly like deepclause-pi's workspace
 * initialisation, using exclusive-create writes so user edits are never
 * overwritten. s2h ships a PHTC-oriented example skill instead of the
 * pi-only tour example.
 */
export async function seedDeepClauseWorkspace(paths: ProjectPaths): Promise<void> {
  await Promise.all([
    mkdir(paths.dcSkillsDir, { recursive: true }),
    mkdir(path.join(paths.dcDir, "plans"), { recursive: true }),
    mkdir(path.join(paths.dcDir, "specs"), { recursive: true }),
    mkdir(path.join(paths.dcDir, "changes"), { recursive: true }),
    mkdir(path.join(paths.dcDir, "lib"), { recursive: true }),
  ]);

  const [authoringGuide, dmlReference, exampleSkill] = await Promise.all([
    readFile(path.join(piPackageDir(), "src", "assets", "AGENTS.md"), "utf8"),
    readFile(path.join(sdkPackageDir(), "dist", "system", "assets", "docs", "DML_REFERENCE.md"), "utf8"),
    readTemplate("example.dml"),
  ]);

  await Promise.all([
    writeIfMissing(paths.dcConfig, `${JSON.stringify(DEEPCLAUSE_DEFAULT_CONFIG, null, 2)}\n`),
    writeIfMissing(path.join(paths.dcDir, "AGENTS.md"), authoringGuide),
    writeIfMissing(path.join(paths.dcDir, "DML_REFERENCE.md"), dmlReference),
    writeIfMissing(path.join(paths.dcSkillsDir, "example.dml"), exampleSkill),
  ]);
}
