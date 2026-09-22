import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { loadManifest, harnessRoot } from "./harness.js";
import { cancelSession, createSession, deleteSession, disposeAll, getSession, provideInput, runTurn } from "./runtime.js";
import { createMcpServer } from "./mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const PORT = Number(process.env.PORT ?? 8080);
const REQUEST_MAX_BYTES = Number(process.env.S2H_REQUEST_MAX_BYTES ?? 262_144);
const RUN_TIMEOUT_MS = Number(process.env.S2H_RUN_TIMEOUT_MS ?? 120_000);
const MAX_CONCURRENT_RUNS = Number(process.env.S2H_MAX_CONCURRENT_RUNS ?? 2);
const API_TOKEN = process.env.S2H_API_TOKEN;
const WEB_DIR = process.env.S2H_WEB_DIR ?? path.join(process.cwd(), "web");
const MCP_PATH = process.env.S2H_MCP_PATH ?? "/mcp";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

function webFilePath(pathname: string): string | null {
  if (!WEB_DIR) return null;
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const root = path.resolve(WEB_DIR);
  const candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return null;
  return candidate;
}

let activeRuns = 0;

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(payload);
}

function jsonError(res: ServerResponse, status: number, code: string, message: string): void {
  json(res, status, { error: { code, message } });
}

function authorized(req: IncomingMessage): boolean {
  if (!API_TOKEN) return true;
  const header = req.headers.authorization ?? "";
  const expected = `Bearer ${API_TOKEN}`;
  return timingSafeEqual(header, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > REQUEST_MAX_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req);
  if (body.length === 0) return {};
  return JSON.parse(body.toString("utf8")) as Record<string, unknown>;
}

function sse(res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
}

function sendEvent(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function resolveDocPath(name: string): Promise<string> {
  const manifest = await loadManifest();
  const entry = manifest.docs.find((doc) => doc === name || path.basename(doc) === name);
  if (!entry) throw new Error("not found");
  const absolute = path.resolve(harnessRoot(), entry);
  const root = path.resolve(harnessRoot());
  if (!absolute.startsWith(root + path.sep) && absolute !== root) throw new Error("not found");
  return absolute;
}

function deepClauseDir(): string {
  return path.join(harnessRoot(), ".pi", "deepclause");
}

function resolveInside(baseDir: string, relPath: string): string {
  const root = path.resolve(baseDir);
  const absolute = path.resolve(root, relPath);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) throw new Error("path escapes workspace");
  return absolute;
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

async function listWorkspaceFiles(subdir: string): Promise<string[]> {
  const base = path.join(deepClauseDir(), subdir);
  const files = await listFilesRecursive(base);
  return files.map((file) => path.relative(deepClauseDir(), file).replaceAll(path.sep, "/"));
}

async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    jsonError(res, 400, "bad_request", error instanceof Error ? error.message : String(error));
    return;
  }

  const message = typeof body.message === "string" ? body.message.slice(0, 16_384) : "";
  if (!message) {
    jsonError(res, 400, "bad_request", "message is required");
    return;
  }
  const skill = typeof body.skill === "string" ? body.skill : undefined;
  const sessionId =
    typeof body.sessionId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(body.sessionId)
      ? body.sessionId
      : `s-${randomBytes(8).toString("hex")}`;

  if (activeRuns >= MAX_CONCURRENT_RUNS) {
    jsonError(res, 429, "busy", "too many concurrent runs");
    return;
  }

  let manifest;
  try {
    manifest = await loadManifest();
  } catch (error) {
    jsonError(res, 500, "harness_error", error instanceof Error ? error.message : String(error));
    return;
  }

  sse(res);
  sendEvent(res, "session", { sessionId, harness: manifest.name, version: manifest.version });

  if (getSession(sessionId)?.running) {
    sendEvent(res, "error", { code: "conflict", message: "session is already running" });
    sendEvent(res, "done", { sessionId, ok: false });
    res.end();
    return;
  }
  const session = createSession(sessionId);
  session.running = true;

  activeRuns += 1;
  const timeout = setTimeout(() => session.controller.abort(), RUN_TIMEOUT_MS);

  const prompt = skill ? `Run the "${skill}" skill for this request:\n\n${message}` : message;

  try {
    const answer = await runTurn(sessionId, prompt, {
      signal: session.controller.signal,
      onEvent: (event) => {
        switch (event.type) {
          case "text":
            sendEvent(res, "stream", { delta: event.delta, kind: "text" });
            break;
          case "thinking":
            sendEvent(res, "stream", { delta: event.delta, kind: "thinking" });
            break;
          case "trace":
            sendEvent(res, "trace", { text: event.text });
            break;
          case "tool":
            sendEvent(res, "tool_call", {
              name: event.name,
              state: event.state,
              args: event.args ?? null,
              result: event.result ?? null,
              isError: event.isError,
            });
            break;
        }
      },
    });
    sendEvent(res, "answer", { content: answer, skill: skill ?? "agent", detail: null });
    sendEvent(res, "done", { sessionId, ok: true });
  } catch (error) {
    sendEvent(res, "error", { code: "runtime_error", message: error instanceof Error ? error.message : String(error) });
    sendEvent(res, "done", { sessionId, ok: false });
  } finally {
    clearTimeout(timeout);
    activeRuns -= 1;
    session.running = false;
    res.end();
  }
}

const server = createServer(async (req, res) => {
  try {
    if (!authorized(req)) {
      jsonError(res, 401, "unauthorized", "missing or invalid bearer token");
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/healthz") {
      const manifest = await loadManifest();
      json(res, 200, { status: "ok", version: manifest.version, uptime: process.uptime() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/harness") {
      const manifest = await loadManifest();
      json(res, 200, {
        name: manifest.name,
        title: manifest.title ?? manifest.name,
        description: manifest.description ?? "",
        version: manifest.version,
        entry: manifest.entry ?? null,
        skills: manifest.skills.map((skill) => ({
          id: skill.id,
          title: skill.title,
          triggers: skill.triggers,
          effects: skill.effects,
        })),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/skills") {
      const manifest = await loadManifest();
      json(res, 200, {
        skills: manifest.skills.map((skill) => ({
          id: skill.id,
          title: skill.title,
          triggers: skill.triggers,
          effects: skill.effects,
        })),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/docs") {
      const manifest = await loadManifest();
      json(res, 200, { docs: manifest.docs.map((doc) => ({ name: path.basename(doc), path: doc })) });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/docs/")) {
      const name = decodeURIComponent(url.pathname.slice("/api/docs/".length));
      try {
        const file = await resolveDocPath(name);
        const content = await readFile(file, "utf8");
        json(res, 200, { name: path.basename(file), path: path.relative(harnessRoot(), file), content });
      } catch {
        jsonError(res, 404, "not_found", "doc not found");
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/dml") {
      json(res, 200, { files: await listWorkspaceFiles("skills") });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/dml/file") {
      const rel = url.searchParams.get("path") ?? "";
      try {
        const file = resolveInside(deepClauseDir(), rel);
        const content = await readFile(file, "utf8");
        json(res, 200, { path: rel, content });
      } catch {
        jsonError(res, 404, "not_found", "dml file not found");
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/diagrams") {
      json(res, 200, { files: await listWorkspaceFiles("diagrams") });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/diagrams/file") {
      const rel = url.searchParams.get("path") ?? "";
      try {
        const file = resolveInside(deepClauseDir(), rel);
        const content = await readFile(file, "utf8");
        json(res, 200, { path: rel, content });
      } catch {
        jsonError(res, 404, "not_found", "diagram file not found");
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      await handleChat(req, res);
      return;
    }

    if (mcpTransport && url.pathname === MCP_PATH) {
      try {
        const body = req.method === "POST" ? await readJsonBody(req) : undefined;
        await mcpTransport.handleRequest(req, res, body);
      } catch (error) {
        jsonError(res, 500, "mcp_error", error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const inputMatch = /^\/api\/sessions\/([A-Za-z0-9_-]{1,64})\/input$/.exec(url.pathname);
    if (req.method === "POST" && inputMatch) {
      const sessionId = inputMatch[1]!;
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        jsonError(res, 400, "bad_request", error instanceof Error ? error.message : String(error));
        return;
      }
      if (typeof body.value !== "string") {
        jsonError(res, 400, "bad_request", "value is required");
        return;
      }
      if (!provideInput(sessionId, body.value)) {
        jsonError(res, getSession(sessionId) ? 409 : 404, getSession(sessionId) ? "no_input_pending" : "not_found", "no input pending");
        return;
      }
      json(res, 200, { ok: true });
      return;
    }

    const cancelMatch = /^\/api\/sessions\/([A-Za-z0-9_-]{1,64})\/cancel$/.exec(url.pathname);
    if (req.method === "POST" && cancelMatch) {
      const sessionId = cancelMatch[1]!;
      json(res, 200, { cancelled: cancelSession(sessionId) });
      return;
    }

    const deleteMatch = /^\/api\/sessions\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
    if (req.method === "DELETE" && deleteMatch) {
      const sessionId = deleteMatch[1]!;
      json(res, 200, { deleted: deleteSession(sessionId) });
      return;
    }

    if (req.method === "GET" && WEB_DIR) {
      const file = webFilePath(url.pathname);
      if (file) {
        try {
          const info = await stat(file);
          if (info.isFile()) {
            const content = await readFile(file);
            res.writeHead(200, { "Content-Type": contentTypeFor(file), "Cache-Control": "no-store" });
            res.end(content);
            return;
          }
        } catch {
          // fall through to 404
        }
      }
    }

    jsonError(res, 404, "not_found", "endpoint not found");
  } catch (error) {
    jsonError(res, 500, "server_error", error instanceof Error ? error.message : String(error));
  }
});

let mcpTransport: StreamableHTTPServerTransport | undefined;
if (process.env.S2H_MCP_ENABLED !== "false") {
  try {
    const mcpServer = await createMcpServer();
    mcpTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomBytes(16).toString("hex") });
    await mcpServer.connect(mcpTransport);
  } catch (error) {
    console.warn("MCP server disabled:", error instanceof Error ? error.message : String(error));
  }
}
server.listen(PORT, () => {
  console.log(`s2h export listening on http://127.0.0.1:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void disposeAll().finally(() => process.exit(0));
  });
}
