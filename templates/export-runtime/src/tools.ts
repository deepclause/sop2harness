import { realpath, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { DeepClauseSDK } from "deepclause-sdk";

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

/**
 * Register the Portable Harness Tool Contract tools declared by the manifest.
 * `ask_user` is provided by the SDK itself; `bash`/`http_fetch` are added in
 * later phases (sandbox/egress).
 */
export function registerHarnessTools(sdk: DeepClauseSDK, root: string, tools: string[]): void {
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
}
