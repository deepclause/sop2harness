import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateHarness } from "../src/harness/validate.js";
import { projectPaths } from "../src/harness/paths.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

const SKILL = `% POLICY: refund-policy
% SOP: sops/refund-desk/README.md
% Effects: none

agent_main(Request) :-
    Request \\= "",
    exec(read_harness_file(path: "AGENTS.md"), FileResult),
    get_dict(content, FileResult, Policy),
    task("Apply the policy to the request.", string(Decision)),
    answer(Decision).

agent_main(_) :-
    answer("Supply a request about refunds or returns.").
`;

function manifest(overrides: Record<string, unknown> = {}): string {
  const value = {
    schemaVersion: 1,
    name: "refund-desk",
    title: "Refund Desk",
    version: "0.1.0",
    entry: null,
    skills: [
      {
        id: "refund-policy",
        path: "skills/refund-policy.dml",
        title: "Refund eligibility",
        triggers: ["refund", "return"],
        effects: "none",
      },
    ],
    runtime: {
      tools: ["read_harness_file", "ask_user"],
      compat: [],
      context: "turn",
      gasLimit: 100_000,
      maxTokens: 16_384,
      streaming: true,
    },
    judgment: {
      default: "llm",
      jev: { enabled: false, model: "jev-latest", apiKeyEnv: "TYPESAFE_API_KEY" },
    },
    docs: ["README.md", "AGENTS.md", "sops/INDEX.md"],
    ...overrides,
  };
  return JSON.stringify(value, null, 2);
}

const AGENTS = `# refund-desk harness

## Procedure routing

| Procedure / trigger | Skill (\`harness.json\` id) | Effects |
| --- | --- | --- |
| Refund / return eligibility | \`refund-policy\` | none |
`;

async function writeFixture(root: string, opts: { skill?: string; manifest?: string; agents?: string } = {}): Promise<void> {
  const paths = projectPaths(root);
  await mkdir(paths.dcSkillsDir, { recursive: true });
  await mkdir(paths.sopsDir, { recursive: true });
  await writeFile(paths.harnessJson, opts.manifest ?? manifest(), "utf8");
  await writeFile(paths.agentsMd, opts.agents ?? AGENTS, "utf8");
  await writeFile(paths.harnessReadme, "# refund-desk\n", "utf8");
  await writeFile(paths.sopsIndex, "# SOP index\n", "utf8");
  await writeFile(path.join(paths.dcSkillsDir, "refund-policy.dml"), opts.skill ?? SKILL, "utf8");
}

async function tempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "s2h-validate-"));
  roots.push(root);
  return root;
}

describe("validateHarness", () => {
  it("accepts a valid fixture harness", async () => {
    const root = await tempProject();
    await writeFixture(root);
    const report = await validateHarness(projectPaths(root));
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("requires a static fallback clause", async () => {
    const root = await tempProject();
    await writeFixture(root, { skill: SKILL.replace("agent_main(_) :-", "agent_main(_Unused) :-") });
    const report = await validateHarness(projectPaths(root));
    expect(report.ok).toBe(false);
    expect(report.errors.join("\n")).toContain("static fallback clause");
  });

  it("requires AGENTS.md and harness.json routing to agree", async () => {
    const root = await tempProject();
    await writeFixture(root, { agents: AGENTS.replace("`refund-policy`", "`other-skill`") });
    const report = await validateHarness(projectPaths(root));
    expect(report.ok).toBe(false);
    expect(report.errors.join("\n")).toContain("missing a routing row");
  });

  it("requires an enabled sandbox for shell tools", async () => {
    const root = await tempProject();
    await writeFixture(root, {
      manifest: manifest({ runtime: { tools: ["bash"], compat: [], context: "turn", gasLimit: 100_000, maxTokens: 16_384, streaming: true } }),
    });
    const report = await validateHarness(projectPaths(root));
    expect(report.ok).toBe(false);
    expect(report.errors.join("\n")).toContain("runtime.sandbox.enabled");
  });
});
