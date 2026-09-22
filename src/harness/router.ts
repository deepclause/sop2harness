import { readFile } from "node:fs/promises";

export interface RouterRow {
  /** Procedure / trigger text from the first column. */
  trigger: string;
  /** Backtick-wrapped skill id from the second column. */
  skillId: string;
  /** Effects text from the third column. */
  effects: string;
}

const HEADER_RE = /\|\s*Procedure[^|]*\|\s*Skill[^|]*\|\s*Effects[^|]*\|/i;

/**
 * Parse the machine-usable policy table from a harness `AGENTS.md`.
 *
 * Only data rows whose second cell contains a single backtick-wrapped skill id
 * are treated as routing rows, so placeholder rows and prose stay inert.
 */
export function parseRouterTable(markdown: string): RouterRow[] {
  const header = markdown.match(HEADER_RE);
  if (!header || header.index === undefined) return [];

  const afterHeader = markdown.slice(header.index + header[0].length);
  const lines = afterHeader.split(/\r?\n/);
  const rows: RouterRow[] = [];

  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    const cells = splitTableRow(line);
    if (cells.length < 3) continue;
    const skillCell = cells[1] ?? "";
    const skillId = extractSkillId(skillCell);
    if (!skillId) continue;
    rows.push({
      trigger: (cells[0] ?? "").trim(),
      skillId,
      effects: (cells[2] ?? "").trim(),
    });
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
  const trimmed = line.trim();
  // Strip leading/trailing pipes, then split on unescaped pipes.
  const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((cell) => cell.trim());
}

function extractSkillId(cell: string): string | null {
  const match = cell.match(/^\s*`([^`]+)`\s*$/);
  if (!match) return null;
  const id = match[1]!.trim();
  return id.length > 0 ? id : null;
}
