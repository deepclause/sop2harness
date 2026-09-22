import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { slugify } from "../project.js";
import { resolveWriteInside } from "../harness/confine.js";
import type { ProjectPaths } from "../harness/paths.js";

const execFileAsync = promisify(execFile);

export interface IngestedFile {
  source: string;
  file: string;
  hash: string;
  changed: boolean;
}

export interface IngestResult {
  slug: string;
  files: IngestedFile[];
  warnings: string[];
}

interface IndexRow {
  source: string;
  file: string;
  hash: string;
  ingested: string;
}

const INDEX_HEADER = "| Source | File | SHA-256 | Ingested |";
const INDEX_SEPARATOR = "| --- | --- | --- | --- |";

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function normalizeText(content: string): string {
  const lines = content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

async function convertToMarkdown(file: string): Promise<string> {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".md" || ext === ".markdown" || ext === ".txt" || ext === ".text") {
    return normalizeText(await readFile(file, "utf8"));
  }

  if (ext === ".pdf") {
    try {
      const { stdout } = await execFileAsync("pdftotext", ["-layout", file, "-"], { maxBuffer: 32 * 1024 * 1024 });
      return normalizeText(`# ${path.basename(file)}\n\n${stdout}`);
    } catch (error) {
      throw new Error(`pdftotext failed for ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (ext === ".docx" || ext === ".html" || ext === ".htm") {
    try {
      const from = ext === ".docx" ? "docx" : "html";
      const { stdout } = await execFileAsync("pandoc", ["-f", from, "-t", "gfm", file], {
        maxBuffer: 32 * 1024 * 1024,
      });
      return normalizeText(stdout);
    } catch (error) {
      throw new Error(`pandoc failed for ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`unsupported SOP format: ${ext || "(no extension)"}`);
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
    if (entry.isDirectory()) {
      result.push(...(await listFilesRecursive(full)));
    } else if (entry.isFile()) {
      result.push(full);
    }
  }
  return result.sort();
}

async function readIndex(indexPath: string): Promise<IndexRow[]> {
  let content: string;
  try {
    content = await readFile(indexPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const rows: IndexRow[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    if (trimmed === INDEX_HEADER || trimmed === INDEX_SEPARATOR) continue;
    const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    if (cells.length < 4) continue;
    const [source, file, hash, ingested] = cells as [string, string, string, string];
    if (!file || !hash) continue;
    rows.push({ source: source ?? "", file: file ?? "", hash: hash ?? "", ingested: ingested ?? "" });
  }
  return rows;
}

async function writeIndex(indexPath: string, rows: IndexRow[]): Promise<void> {
  const sorted = [...rows].sort((a, b) => a.file.localeCompare(b.file));
  const lines = [
    "# SOP index",
    "",
    INDEX_HEADER,
    INDEX_SEPARATOR,
    ...sorted.map((row) => `| ${row.source} | ${row.file} | ${row.hash} | ${row.ingested} |`),
    "",
  ];
  await writeFile(indexPath, lines.join("\n"), "utf8");
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

/**
 * Ingest SOP inputs into `harness/sops/<slug>/` and keep `sops/INDEX.md` in
 * sync. Unchanged files are skipped; changed files are re-normalised and
 * reported so `create` can decide whether to re-author.
 */
export async function ingestSources(
  paths: ProjectPaths,
  inputs: string[],
  name?: string,
): Promise<IngestResult> {
  const warnings: string[] = [];
  const files: IngestedFile[] = [];
  const first = inputs[0];
  const slug = name ? slugify(name) : slugify(path.basename(first ?? "sop").replace(/\.[^.]+$/, ""));

  await mkdir(paths.sopsDir, { recursive: true });
  const indexPath = paths.sopsIndex;
  const indexByFile = new Map<string, IndexRow>();
  for (const row of await readIndex(indexPath)) indexByFile.set(row.file, row);

  for (const input of inputs) {
    const source = path.resolve(input);
    if (!(await exists(source))) {
      warnings.push(`SOP input not found, skipping: ${input}`);
      continue;
    }

    const sourceStat = await stat(source);
    const sourceEntries: Array<{ sourceFile: string; relative: string }> = [];
    if (sourceStat.isDirectory()) {
      const base = source;
      for (const file of await listFilesRecursive(base)) {
        sourceEntries.push({ sourceFile: file, relative: path.relative(base, file) });
      }
    } else {
      sourceEntries.push({ sourceFile: source, relative: path.basename(source) });
    }

    for (const { sourceFile, relative } of sourceEntries) {
      let content: string;
      try {
        content = await convertToMarkdown(sourceFile);
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error));
        continue;
      }

      const fileRel = `${slug}/${relative.replaceAll(path.sep, "/")}`;
      const hash = sha256(content);
      const target = resolveWriteInside(paths.sopsDir, path.join(slug, relative));
      const previous = indexByFile.get(fileRel);

      if (previous && previous.hash === hash) {
        files.push({ source: input, file: fileRel, hash, changed: false });
        indexByFile.set(fileRel, previous);
        continue;
      }

      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
      const ingested = new Date().toISOString();
      indexByFile.set(fileRel, { source: input, file: fileRel, hash, ingested });
      files.push({ source: input, file: fileRel, hash, changed: true });
    }
  }

  await writeIndex(
    indexPath,
    [...indexByFile.values()].map((row) => ({
      source: escapeCell(row.source),
      file: row.file,
      hash: row.hash,
      ingested: row.ingested,
    })),
  );

  return { slug, files, warnings };
}
