import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolveProject } from "../project.js";
import { validateHarness } from "../harness/validate.js";
import { loadManifest } from "../harness/manifest.js";
import * as ui from "../ui.js";

const execFileAsync = promisify(execFile);

export interface ExportOptions {
  out?: string;
  tag?: string;
  llm?: string;
  sandbox?: string;
  mcp?: boolean;
  web?: boolean;
  allowEffects?: boolean;
  port?: string;
}

const TEMPLATE_DIR = fileURLToPath(new URL("../../templates/export-runtime/", import.meta.url));

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function listFilesRecursive(dir: string): Promise<string[]> {
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
    if (entry.isDirectory()) result.push(...(await listFilesRecursive(full)));
    else if (entry.isFile()) result.push(full);
  }
  return result.sort();
}

async function hashHarness(harnessDir: string): Promise<string> {
  const hash = createHash("sha256");
  for (const file of await listFilesRecursive(harnessDir)) {
    hash.update(path.relative(harnessDir, file));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function gitHead(root: string): Promise<string | undefined> {
  try {
    return (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
  } catch {
    return undefined;
  }
}

async function copyTemplateFiles(outDir: string, substitutions: Record<string, string>, excludePrefixes: string[] = []): Promise<void> {
  for (const file of await listFilesRecursive(TEMPLATE_DIR)) {
    const rel = path.relative(TEMPLATE_DIR, file).replaceAll(path.sep, "/");
    if (excludePrefixes.some((prefix) => rel.startsWith(prefix))) continue;
    const target = path.join(outDir, rel);
    await mkdir(path.dirname(target), { recursive: true });
    let content = await readFile(file, "utf8");
    for (const [token, value] of Object.entries(substitutions)) {
      content = content.replaceAll(token, value);
    }
    await writeFile(target, content, "utf8");
  }
}

export async function exportCommand(cwd: string, options: ExportOptions): Promise<number> {
  let project;
  try {
    project = await resolveProject(cwd);
  } catch (error) {
    ui.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const { root, paths } = project;

  if (options.tag) {
    ui.error("Exporting a tagged version (--tag) is not implemented yet.");
    return 1;
  }
  if (options.llm && options.llm !== "pi") {
    ui.error(`--llm ${options.llm} is not implemented yet; use --llm pi.`);
    return 1;
  }
  if (options.sandbox && options.sandbox !== "none" && options.sandbox !== "agentvm") {
    ui.error(`--sandbox ${options.sandbox} is not supported; use agentvm or none.`);
    return 1;
  }

  const report = await validateHarness(paths);
  for (const message of report.warnings) ui.warn(message);
  for (const message of report.errors) ui.error(message);
  if (!report.ok) {
    ui.error("Refusing to export an invalid harness.");
    return 1;
  }

  const manifest = await loadManifest(paths.harnessJson);
  const shellNeeded =
    manifest.runtime.tools.includes("bash") ||
    manifest.runtime.compat.includes("pi_bash") ||
    manifest.runtime.sandbox?.enabled === true;

  const sandboxMode = options.sandbox ?? (shellNeeded ? "agentvm" : "none");
  if (shellNeeded && sandboxMode !== "agentvm") {
    ui.error("This harness declares shell execution; pass --sandbox agentvm (or omit the flag).");
    return 1;
  }
  if (!shellNeeded && sandboxMode === "agentvm") {
    ui.warn("Sandbox requested but the harness does not declare shell tools; exporting without sandbox.");
  }
  const includeSandbox = shellNeeded && sandboxMode === "agentvm";

  const effects = manifest.skills.filter((skill) => skill.effects && skill.effects !== "none");
  if (effects.length > 0 && !options.allowEffects) {
    ui.error(`Harness declares effects; pass --allow-effects to export it.`);
    for (const skill of effects) ui.info(`  - ${skill.id}: ${skill.effects}`);
    return 1;
  }

  const outDir = path.resolve(cwd, options.out ?? "export");
  ui.section(`Exporting ${manifest.name} v${manifest.version}`);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const includeWeb = options.web !== false;
  const includeMcp = options.mcp !== false;
  const runtimeEnv = includeWeb
    ? "NODE_ENV=production PORT=8080 S2H_HARNESS_DIR=/app/harness S2H_WEB_DIR=/app/web"
    : "NODE_ENV=production PORT=8080 S2H_HARNESS_DIR=/app/harness";
  const webCopy = includeWeb ? "COPY web ./web" : "# web app omitted (--no-web)";
  const agentvmDep = includeSandbox ? ",\n    \"deepclause-agentvm\": \"0.4.0\"" : "";
  const mcpDep = includeMcp
    ? ",\n    \"@modelcontextprotocol/sdk\": \"1.25.3\",\n    \"zod\": \"^3.25.0\""
    : "";
  const sandboxCopy = includeSandbox
    ? "COPY --from=build /app/node_modules/deepclause-agentvm/agentvm-alpine-python.wasm ./agentvm/"
    : "# agentvm sandbox omitted";
  const sandboxEnv = includeSandbox
    ? "ENV S2H_AGENTVM_WASM=/app/agentvm/agentvm-alpine-python.wasm\nENV S2H_SANDBOX_DIR=/var/lib/s2h/sandbox"
    : "# agentvm sandbox omitted";
  const sandboxVolume = includeSandbox ? 'VOLUME ["/var/lib/s2h/sandbox"]' : "# agentvm sandbox omitted";
  const mcpImport = includeMcp
    ? 'import { createMcpServer } from "./mcp.js";\nimport { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";'
    : "";
  const mcpMountSetup = includeMcp
    ? `let mcpTransport: StreamableHTTPServerTransport | undefined;
if (process.env.S2H_MCP_ENABLED !== "false") {
  try {
    const mcpServer = await createMcpServer();
    mcpTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomBytes(16).toString("hex") });
    await mcpServer.connect(mcpTransport);
  } catch (error) {
    console.warn("MCP server disabled:", error instanceof Error ? error.message : String(error));
  }
}`
    : "";
  const mcpHandler = includeMcp
    ? `if (mcpTransport && url.pathname === MCP_PATH) {
      try {
        const body = req.method === "POST" ? await readJsonBody(req) : undefined;
        await mcpTransport.handleRequest(req, res, body);
      } catch (error) {
        jsonError(res, 500, "mcp_error", error instanceof Error ? error.message : String(error));
      }
      return;
    }`
    : "";

  // Harness copy (read-only at runtime) + generated runtime.
  await cp(paths.harnessDir, path.join(outDir, "harness"), { recursive: true });
  await copyTemplateFiles(
    outDir,
    {
      __HARNESS_NAME__: manifest.name,
      __HARNESS_VERSION__: manifest.version,
      __RUNTIME_ENV__: runtimeEnv,
      __WEB_COPY__: webCopy,
      __AGENTVM_DEP__: agentvmDep,
      __MCP_DEP__: mcpDep,
      __SANDBOX_COPY__: sandboxCopy,
      __SANDBOX_ENV__: sandboxEnv,
      __SANDBOX_VOLUME__: sandboxVolume,
      __MCP_IMPORT__: mcpImport,
      __MCP_MOUNT_SETUP__: mcpMountSetup,
      __MCP_HANDLER__: mcpHandler,
    },
    includeMcp ? [] : ["src/mcp.ts", "src/mcp-stdio.ts"],
  );
  if (!includeWeb) {
    await rm(path.join(outDir, "web"), { recursive: true, force: true });
  }

  const s2hVersion = JSON.parse(await readFile(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as {
    version: string;
  };
  const lock = {
    s2h: s2hVersion.version,
    deepclauseSdk: "0.0.89",
    deepclausePi: "0.5.0",
    deepclauseAgentvm: "0.4.0",
    harnessVersion: manifest.version,
    commit: await gitHead(root),
    hash: await hashHarness(paths.harnessDir),
  };
  await writeFile(path.join(outDir, "harness.lock.json"), `${JSON.stringify(lock, null, 2)}\n`, "utf8");

  ui.ok(`Exported to ${outDir}`);
  ui.section("Runtime configuration");
  ui.info("  Model:  S2H_LLM_BACKEND=pi  S2H_LLM_PROVIDER=<provider>  S2H_LLM_MODEL=<model>");
  ui.info("  Server: PORT, S2H_API_TOKEN, S2H_HARNESS_DIR, S2H_WEB_DIR");
  ui.info("  Limits: S2H_MAX_CONCURRENT_RUNS, S2H_REQUEST_MAX_BYTES, S2H_RUN_TIMEOUT_MS");
  if (includeSandbox) {
    ui.info("  Sandbox: S2H_AGENTVM_WASM, S2H_SANDBOX_DIR, S2H_SANDBOX_NETWORK_RATE");
  }
  if (includeMcp) {
    ui.info("  MCP: S2H_MCP_ENABLED, S2H_MCP_PATH, S2H_MCP_TOOL_PREFIX, S2H_MCP_TOOL_NAME");
  }
  ui.info("  Judge:  TYPESAFE_API_KEY (optional calibrated jev backend)");
  ui.info("");
  ui.info("Copy export/.env.example to export/.env, set the model provider/model, and run:");
  ui.info("  cd export && npm install && npm run build && npm start");
  ui.info("Or: cd export && docker compose up --build");
  return 0;
}
