import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { projectPaths } from "../harness/paths.js";
import { defaultManifest, writeManifest } from "../harness/manifest.js";
import { seedDeepClauseWorkspace } from "../deepclause/seed.js";
import { slugify } from "../project.js";
import * as ui from "../ui.js";

const execFileAsync = promisify(execFile);
const TEMPLATE_DIR = fileURLToPath(new URL("../../templates/init/", import.meta.url));

export interface InitOptions {
  name?: string;
  model?: string;
  force?: boolean;
}

const GITIGNORE = `# Dependencies
node_modules/

# Build output
dist/
export/

# Authoring sessions and local state
.s2h/sessions/

# Secrets and local environment
.env
.env.*
!.env.example

# Packaging
*.tgz

# OS noise
.DS_Store
Thumbs.db
`;

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function writeExclusive(p: string, content: string): Promise<void> {
  try {
    await writeFile(p, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

async function writeTemplate(name: string, target: string, harnessName: string): Promise<void> {
  const template = await readFile(path.join(TEMPLATE_DIR, name), "utf8");
  await writeExclusive(target, template.replaceAll("{{name}}", harnessName));
}

async function ensureGitRepo(root: string): Promise<boolean> {
  if (await exists(path.join(root, ".git"))) return false;
  try {
    await execFileAsync("git", ["init", "--quiet"], { cwd: root });
    return true;
  } catch (error) {
    ui.warn(`Could not initialize git: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export async function initCommand(cwd: string, options: InitOptions): Promise<number> {
  const root = path.resolve(cwd);
  const name = options.name ? slugify(options.name) : slugify(path.basename(root));
  const paths = projectPaths(root);

  const alreadyInit = (await exists(paths.s2hJson)) || (await exists(paths.harnessJson));
  if (alreadyInit && !options.force) {
    ui.error(`Project already initialized at ${root}. Use --force to re-initialize.`);
    return 1;
  }

  // Directories first.
  await Promise.all([
    mkdir(path.join(root, ".s2h"), { recursive: true }),
    mkdir(paths.sessionsDir, { recursive: true }),
    mkdir(paths.sopsDir, { recursive: true }),
  ]);

  // Project config and manifest are the only files --force may overwrite.
  const projectConfig = `${JSON.stringify({ name, model: options.model ?? null, harnessDir: "harness" }, null, 2)}\n`;
  if (options.force) {
    await writeFile(paths.s2hJson, projectConfig, "utf8");
  } else {
    await writeExclusive(paths.s2hJson, projectConfig);
  }

  const manifest = defaultManifest(name);
  if (options.force) {
    await writeManifest(paths.harnessJson, manifest);
  } else {
    await writeExclusive(paths.harnessJson, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  // Everything else is exclusive-create: never clobber user files.
  await Promise.all([
    writeExclusive(path.join(root, ".gitignore"), GITIGNORE),
    writeTemplate("harness-README.md", paths.harnessReadme, name),
    writeTemplate("harness-AGENTS.md", paths.agentsMd, name),
    writeTemplate("sops-INDEX.md", paths.sopsIndex, name),
  ]);

  await seedDeepClauseWorkspace(paths);

  const initializedGit = await ensureGitRepo(root);

  ui.ok(`Initialized harness '${name}' in ${root}`);
  ui.info(`  harness/          the deliverable (DML + manifest + docs)`);
  ui.info(`  harness/sops/     drop SOP source files here`);
  ui.info(`  .s2h/             metadata and authoring sessions`);
  if (initializedGit) ui.info(`  git repository initialized`);
  ui.info(``);
  ui.info(`Next steps:`);
  ui.info(`  s2h check`);
  ui.info(`  s2h create "Turn this SOP into a harness" --file ./procedure.md`);
  ui.info(`  s2h export --out ./export`);
  return 0;
}
