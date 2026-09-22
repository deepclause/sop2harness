import { mkdtemp, readFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initCommand } from "../src/commands/init.js";
import { validateHarness } from "../src/harness/validate.js";
import { projectPaths } from "../src/harness/paths.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.map((root) => import("node:fs/promises").then((fs) => fs.rm(root, { recursive: true, force: true }))),
  );
  roots.length = 0;
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "s2h-init-"));
  roots.push(root);
  return root;
}

describe("initCommand", () => {
  it("scaffolds a valid empty harness", async () => {
    const root = await tempProject();
    const code = await initCommand(root, { name: "Refund Desk" });
    expect(code).toBe(0);

    const paths = projectPaths(root);
    await expect(readFile(paths.s2hJson, "utf8")).resolves.toContain("refund-desk");
    await expect(access(paths.harnessJson)).resolves.toBeUndefined();
    await expect(access(paths.agentsMd)).resolves.toBeUndefined();
    await expect(access(path.join(paths.dcSkillsDir, "example.dml"))).resolves.toBeUndefined();

    const report = await validateHarness(paths);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("refuses to re-initialize without --force", async () => {
    const root = await tempProject();
    expect(await initCommand(root, {})).toBe(0);
    expect(await initCommand(root, {})).toBe(1);
  });
});
