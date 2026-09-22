import { realpath, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { DeepClauseSDK } from "deepclause-sdk";
import type { Sandbox } from "./sandbox.js";
import type { Session } from "./runtime.js";

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolveInside(root: string, relPath: string): Promise<string> {
  const absolute = path.resolve(root, relPath);
  if (!isInside(root, absolute)) throw new Error(`Path escapes harness root: ${relPath}`);
  const [realRoot, realChild] = await Promise.all([realpath(root), realpath(absolute)]);
  if (!isInside(realRoot, realChild)) throw new Error(`Path escapes harness root through a symlink: ${relPath}`);
  return realChild;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function shellJoin(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}

/**
 * Register the Portable Harness Tool Contract tools declared by the manifest.
 * `ask_user` is provided by the SDK itself; `bash`/`pi_bash` run in the
 * AgentVM sandbox (ADR-0001); `http_fetch` is added in a later phase.
 */
export function registerHarnessTools(
  sdk: DeepClauseSDK,
  root: string,
  tools: string[],
  compat: string[],
  session: Session,
  sandbox?: Sandbox,
): void {
  if (tools.includes("read_harness_file")) {
    sdk.registerTool("read_harness_file", {
      description: "Read a UTF-8 file inside the harness root.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Harness-relative file path" } },
        required: ["path"],
      },
      execute: async (args) => {
        const relPath = typeof args.path === "string" ? args.path : "";
        if (!relPath) throw new Error("read_harness_file requires a path");
        const real = await resolveInside(root, relPath);
        const content = await readFile(real, "utf8");
        return { content };
      },
    });
  }

  if (tools.includes("list_harness_files")) {
    sdk.registerTool("list_harness_files", {
      description: "List one directory level inside the harness root.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Harness-relative directory path" } },
        required: ["path"],
      },
      execute: async (args) => {
        const relPath = typeof args.path === "string" ? args.path : ".";
        const real = await resolveInside(root, relPath);
        const entries = await readdir(real);
        return { entries: entries.sort() };
      },
    });
  }

  if (tools.includes("ask_user")) {
    sdk.registerTool("ask_user", {
      description: "Ask the user one focused question and return their response.",
      parameters: {
        type: "object",
        properties: { prompt: { type: "string", description: "The question to show the user" } },
        required: ["prompt"],
      },
      execute: async (args) => {
        const prompt = typeof args.prompt === "string" ? args.prompt : "";
        return new Promise<{ user_response: string }>((resolve, reject) => {
          session.resolveInput = (value) => resolve({ user_response: value });
          session.rejectInput = reject;
          if (session.controller.signal.aborted) reject(new Error("session aborted while waiting for input"));
        });
      },
    });
  }

  if (tools.includes("bash") || compat.includes("pi_bash")) {
    if (!sandbox) throw new Error("bash/pi_bash declared but no sandbox is available");

    const registerShellTool = (name: string, description: string): void => {
      sdk.registerTool(name, {
        description,
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "Shell command string, or executable name when args are provided" },
            args: { type: "array", description: "Optional argv to run without shell parsing" },
          },
          required: ["command"],
        },
        execute: async (args) => {
          const command = typeof args.command === "string" ? args.command.trim() : "";
          if (!command) throw new Error(`${name} requires a command`);
          const argv = Array.isArray(args.args) ? args.args.map((value) => String(value)) : [];
          const full = argv.length > 0 ? shellJoin(command, argv) : command;
          return sandbox.exec(full);
        },
      });
    };

    registerShellTool("bash", "Run a command inside the AgentVM sandbox (network off by default, harness mounted at /mnt/harness).");
    registerShellTool("pi_bash", "Compatibility alias for bash that runs inside the AgentVM sandbox.");
  }
}
