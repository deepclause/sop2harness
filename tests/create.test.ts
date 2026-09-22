import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCommand } from "../src/commands/create.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "s2h-create-"));
  roots.push(root);
  await writeFile(path.join(root, "s2h.json"), JSON.stringify({ name: "fixture", model: null, harnessDir: "harness" }), "utf8");
  await mkdir(path.join(root, "harness"), { recursive: true });
  await writeFile(path.join(root, "harness", "harness.json"), JSON.stringify({ schemaVersion: 1, name: "fixture", version: "0.0.0", skills: [] }), "utf8");
  return root;
}

describe("createCommand", () => {
  it("refuses to run without a request or --file", async () => {
    const root = await tempProject();
    expect(await createCommand(root, {})).toBe(1);
  });
});
