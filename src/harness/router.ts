import { readFile } from "node:fs/promises";

export interface RouterRow {
  /** Procedure / trigger text from the first column. */
  trigger: string;
  /** Backtick-wrapped DML skill path from the second column, e.g. `skills/refund.dml`. */
  skillPath: string;
}

const HEADER_RE = /\|\s*Procedure[^|]*\|\s*Skill[^|]*\|\s*Args[^|]*\|/i;

/**
 * Parse the deepclause-pi policy-routing table from a harness `AGENTS.md`.
 * Rows whose second cell contains a single backtick-wrapped `skills/<slug>.dml`
 * path are treated as routing rows.
 */
export function parseRouterTable(markdown: string): RouterRow[] {
  const header = markdown.match(HEADER_RE);
  if (!header || header.index === undefined) return [];

  const afterHeader = markdown.slice(header.index + header[0].length);
  const rows: RouterRow[] = [];
  for (const line of afterHeader.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const cells = splitTableRow(line);
    if (cells.length < 2) continue;
    const skillPath = extractSkillPath(cells[1] ?? "");
    if (!skillPath) continue;
    rows.push({ trigger: (cells[0] ?? "").trim(), skillPath });
  }
  return rows;
}

export async function parseRouterFile(path: string): Promise<RouterRow[]> {
  let markdown: string;
  try {
    markdown = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return parseRouterTable(markdown);
}

function splitTableRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((cell) => cell.trim());
}

function extractSkillPath(cell: string): string | null {
  const match = cell.match(/^\s*`([^`]+)`\s*$/);
  if (!match) return null;
  const path = match[1]!.trim();
  return path.length > 0 ? path : null;
}
