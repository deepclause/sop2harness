import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initCommand } from "../src/commands/init.js";
import { exportCommand } from "../src/commands/export.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "s2h-export-"));
  roots.push(root);
  await initCommand(root, { name: "fixture" });
  return root;
}

describe("exportCommand", () => {
  it("generates a runnable export skeleton", async () => {
    const root = await tempProject();
    expect(await exportCommand(root, { out: "export" })).toBe(0);

    await expect(readFile(path.join(root, "export", "harness", "harness.json"), "utf8")).resolves.toContain('"name": "fixture"');
    await expect(readFile(path.join(root, "export", "src", "server.ts"), "utf8")).resolves.toContain("/api/chat");
    await expect(readFile(path.join(root, "export", "package.json"), "utf8")).resolves.toContain("deepclause-sdk");
    await expect(readFile(path.join(root, "export", "harness.lock.json"), "utf8")).resolves.toContain('"harnessVersion"');
  });

  it("rejects a harness that declares shell execution", async () => {
    const root = await tempProject();
    await writeFile(
      path.join(root, "harness", "harness.json"),
      JSON.stringify({
        schemaVersion: 1,
        name: "fixture",
        version: "0.1.0",
        entry: null,
        skills: [],
        runtime: {
          tools: ["bash"],
          compat: [],
          context: "turn",
          gasLimit: 100000,
          maxTokens: 16384,
          streaming: true,
          sandbox: { provider: "agentvm", enabled: true, network: false, allow: [], mounts: {}, persistentRoot: false, limits: { timeoutMs: 120000, maxOutputBytes: 200000 } },
        },
        judgment: { default: "llm", jev: { enabled: false, model: "jev-latest", apiKeyEnv: "TYPESAFE_API_KEY" } },
        docs: ["README.md", "AGENTS.md", "sops/INDEX.md"],
      }),
      "utf8",
    );
    expect(await exportCommand(root, { out: "export" })).toBe(1);
  });
});
