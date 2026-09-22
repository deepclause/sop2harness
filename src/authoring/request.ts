export interface AuthoringRequestInput {
  /** Free-text description from the CLI, if any. */
  request?: string;
  /** SOP files relative to the harness root (e.g. `sops/refund-desk/README.md`). */
  sopFiles: string[];
  /** Suggested harness/procedure name. */
  name?: string;
  /** True for `s2h create --update`. */
  update: boolean;
}

export function buildAuthoringRequest(input: AuthoringRequestInput): string {
  const lines: string[] = [];

  if (input.update) {
    lines.push("Update this s2h harness from the Standard Operating Procedures below.");
  } else {
    lines.push("Author this s2h harness from the Standard Operating Procedures below.");
  }

  if (input.name) lines.push(`Harness name: ${input.name}`);

  if (input.sopFiles.length > 0) {
    lines.push("");
    lines.push("Ingested SOP sources (relative to the harness root):");
    for (const file of input.sopFiles) lines.push(`- ${file}`);
  }

  if (input.request) {
    lines.push("");
    lines.push("Additional request:");
    lines.push(input.request);
  }

  lines.push("");
  lines.push("Follow the `s2h-authoring` skill. Read `.pi/deepclause/AGENTS.md` and");
  lines.push("`.pi/deepclause/DML_REFERENCE.md` first, then the SOP sources above.");
  if (input.update) {
    lines.push("This is an update: regenerate generated skills, add procedures for any new");
    lines.push("SOP content, and preserve user-owned skills and edits.");
  } else {
    lines.push("Create new skills only; do not overwrite existing skills or delete user files.");
  }
  lines.push("Proceed autonomously (do not ask for confirmation). Work inside the harness");
  lines.push("root, write valid DML directly (no compiler), author a general assistant skill");
  lines.push("plus one skill per procedure, write presentation and specification Mermaid");
  lines.push("diagrams for each procedure skill under .pi/deepclause/diagrams/, update");
  lines.push("harness.json and harness/AGENTS.md, and stop before any destructive or external");
  lines.push("side effect.");

  return lines.join("\n");
}
