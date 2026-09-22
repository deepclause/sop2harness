import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { loadManifest, harnessRoot } from "./harness.js";
import { routeRequest } from "./router.js";
import { cancelSession, createSession, deleteSession, getSession, provideInput, runSkill } from "./runtime.js";

const PORT = Number(process.env.PORT ?? 8080);
const REQUEST_MAX_BYTES = Number(process.env.S2H_REQUEST_MAX_BYTES ?? 262_144);
const RUN_TIMEOUT_MS = Number(process.env.S2H_RUN_TIMEOUT_MS ?? 120_000);
const MAX_CONCURRENT_RUNS = Number(process.env.S2H_MAX_CONCURRENT_RUNS ?? 2);
const API_TOKEN = process.env.S2H_API_TOKEN;
const WEB_DIR = process.env.S2H_WEB_DIR;

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

  const route = routeRequest(manifest, message, skill);

  sse(res);
  sendEvent(res, "session", { sessionId, harness: manifest.name, version: manifest.version });
  if (!route.skill) {
    sendEvent(res, "input_required", { prompt: "Which procedure should handle this request?" });
    sendEvent(res, "done", { sessionId, ok: false });
    res.end();
    return;
  }
  sendEvent(res, "route", { skill: route.skill.id, reason: route.reason, confidence: null });

  if (getSession(sessionId)) {
    sendEvent(res, "error", { code: "conflict", message: "session is already running" });
    sendEvent(res, "done", { sessionId, ok: false });
    res.end();
    return;
  }
  const session = createSession(sessionId);

  activeRuns += 1;
  const timeout = setTimeout(() => session.controller.abort(), RUN_TIMEOUT_MS);

  try {
    for await (const event of runSkill(route.skill.id, message, { sessionId, signal: session.controller.signal })) {
      switch (event.type) {
        case "answer":
          sendEvent(res, "answer", { content: event.content, skill: route.skill.id, detail: null });
          break;
        case "stream":
          sendEvent(res, "stream", { delta: event.content ?? "" });
          break;
        case "output":
        case "log":
          sendEvent(res, "stream", { delta: event.content ?? "" });
          break;
        case "tool_call":
          sendEvent(res, "tool_call", { name: event.toolName, state: event.toolState ?? "running" });
          break;
        case "task_activity":
          sendEvent(res, "task_activity", { state: event.taskState ?? "running", description: event.taskDescription ?? "" });
          break;
        case "input_required":
          sendEvent(res, "input_required", { prompt: event.prompt ?? "" });
          break;
        case "usage":
          sendEvent(res, "usage", event.usage ?? {});
          break;
        case "error":
          sendEvent(res, "error", { code: "runtime_error", message: event.content ?? "runtime error" });
          break;
        case "finished":
        case "memory_compaction":
          break;
      }
    }
    sendEvent(res, "done", { sessionId, ok: true });
  } catch (error) {
    sendEvent(res, "error", { code: "runtime_error", message: error instanceof Error ? error.message : String(error) });
    sendEvent(res, "done", { sessionId, ok: false });
  } finally {
    clearTimeout(timeout);
    activeRuns -= 1;
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

    if (req.method === "POST" && url.pathname === "/api/chat") {
      await handleChat(req, res);
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

server.listen(PORT, () => {
  console.log(`s2h export listening on http://127.0.0.1:${PORT}`);
});
