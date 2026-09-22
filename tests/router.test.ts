import { describe, expect, it } from "vitest";
import { parseRouterTable } from "../src/harness/router.js";

const TABLE = `# refund-desk harness

## Procedure routing

When a request matches a procedure below, run the mapped skill and report its answer.

| Procedure / trigger | Skill (\`harness.json\` id) | Effects |
| --- | --- | --- |
| Refund / return eligibility | \`refund-policy\` | none |
| Visit schedule / next contact | \`anc-schedule\` | none |
| _(no procedures yet)_ | | |
`;

describe("parseRouterTable", () => {
  it("extracts only backtick-wrapped skill rows", () => {
    const rows = parseRouterTable(TABLE);
    expect(rows).toEqual([
      { trigger: "Refund / return eligibility", skillId: "refund-policy", effects: "none" },
      { trigger: "Visit schedule / next contact", skillId: "anc-schedule", effects: "none" },
    ]);
  });

  it("returns an empty list without a router header", () => {
    expect(parseRouterTable("# hello\n\nno table here\n")).toEqual([]);
  });

  it("ignores the empty placeholder row", () => {
    const rows = parseRouterTable(TABLE);
    expect(rows.some((row) => row.skillId === "")).toBe(false);
  });
});
