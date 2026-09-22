import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ingestSources } from "../src/authoring/ingest.js";
import { projectPaths } from "../src/harness/paths.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "s2h-ingest-"));
  roots.push(root);
  return root;
}

describe("ingestSources", () => {
  it("normalises, stores, and indexes a Markdown SOP", async () => {
    const root = await tempProject();
    const source = path.join(root, "source.md");
    await writeFile(source, "# Refund\n\nRefunds within 30 days.   \n", "utf8");

    const result = await ingestSources(projectPaths(root), [source]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.changed).toBe(true);
    expect(result.files[0]!.file).toBe(`${result.slug}/source.md`);

    const stored = await readFile(path.join(root, "harness", "sops", result.slug, "source.md"), "utf8");
    expect(stored).toBe("# Refund\n\nRefunds within 30 days.\n");
    expect(await readFile(path.join(root, "harness", "sops", "INDEX.md"), "utf8")).toContain(result.files[0]!.hash);
  });

  it("skips unchanged files on re-ingest and updates changed ones", async () => {
    const root = await tempProject();
    const source = path.join(root, "source.md");
    await writeFile(source, "# Refund\n", "utf8");

    const first = await ingestSources(projectPaths(root), [source]);
    expect(first.files[0]!.changed).toBe(true);

    const second = await ingestSources(projectPaths(root), [source]);
    expect(second.files[0]!.changed).toBe(false);

    await writeFile(source, "# Refund\n\nReturns accepted.\n", "utf8");
    const third = await ingestSources(projectPaths(root), [source]);
    expect(third.files[0]!.changed).toBe(true);
  });

  it("ingests directories recursively with relative paths", async () => {
    const root = await tempProject();
    const sourceDir = path.join(root, "sop-dir");
    await mkdir(path.join(sourceDir, "nested"), { recursive: true });
    await writeFile(path.join(sourceDir, "a.md"), "# A\n", "utf8");
    await writeFile(path.join(sourceDir, "nested", "b.txt"), "B\n", "utf8");

    const result = await ingestSources(projectPaths(root), [sourceDir]);
    expect(result.files.map((file) => file.file).sort()).toEqual([
      `${result.slug}/a.md`,
      `${result.slug}/nested/b.txt`,
    ]);
  });
});
