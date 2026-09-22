import { describe, expect, it } from "vitest";
import { parseRouterTable } from "../src/harness/router.js";

const TABLE = `# refund-desk harness

## DeepClause policy routing

When a request matches a procedure below, do **not** answer from memory. Call the
\`dc_run\` tool with the mapped skill, then report its answer.

| Procedure / trigger | Skill (\`dc_run.skill\`) | Args (\`dc_run.args\`) |
| --- | --- | --- |
| Refund / return eligibility | \`skills/refund-policy.dml\` | \`["<the user's request>"]\` |
| Visit schedule / next contact | \`skills/anc-schedule.dml\` | \`["<the user's request>"]\` |
| _(no procedures yet)_ | | |
`;

describe("parseRouterTable", () => {
  it("extracts only backtick-wrapped skill paths", () => {
    const rows = parseRouterTable(TABLE);
    expect(rows).toEqual([
      { trigger: "Refund / return eligibility", skillPath: "skills/refund-policy.dml" },
      { trigger: "Visit schedule / next contact", skillPath: "skills/anc-schedule.dml" },
    ]);
  });

  it("returns an empty list without a router header", () => {
    expect(parseRouterTable("# hello\n\nno table here\n")).toEqual([]);
  });

  it("ignores the empty placeholder row", () => {
    const rows = parseRouterTable(TABLE);
    expect(rows.some((row) => row.skillPath === "")).toBe(false);
  });
});
