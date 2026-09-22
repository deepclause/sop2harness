import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initCommand } from "../src/commands/init.js";
import { commitCommand } from "../src/commands/commit.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "s2h-commit-"));
  roots.push(root);
  await initCommand(root, { name: "fixture" });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  return root;
}

describe("commitCommand", () => {
  it("dry-runs without changing anything", async () => {
    const root = await tempProject();
    expect(await commitCommand(root, { dryRun: true, message: "init" })).toBe(0);

    const versions = path.join(root, ".s2h", "versions.json");
    await expect(readFile(versions, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    const tags = await execFileAsync("git", ["tag", "-l"], { cwd: root });
    expect(tags.stdout.trim()).toBe("");
  });

  it("commits the harness, tags it, and records the version", async () => {
    const root = await tempProject();
    expect(await commitCommand(root, { message: "initial harness" })).toBe(0);

    const versions = JSON.parse(await readFile(path.join(root, ".s2h", "versions.json"), "utf8")) as {
      versions: Array<{ version: string; commit: string; message: string }>;
    };
    expect(versions.versions).toHaveLength(1);
    expect(versions.versions[0]!.version).toBe("0.0.1");
    expect(versions.versions[0]!.message).toBe("initial harness");
    expect(versions.versions[0]!.commit).toMatch(/^[0-9a-f]{40}$/);

    const tags = await execFileAsync("git", ["tag", "-l"], { cwd: root });
    expect(tags.stdout.trim()).toBe("v0.0.1");

    const status = await execFileAsync("git", ["status", "--porcelain"], { cwd: root });
    expect(status.stdout.trim()).toBe("");
  });
});
