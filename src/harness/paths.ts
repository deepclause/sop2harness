import path from "node:path";

export interface ProjectPaths {
  /** Repository/project root (the directory that contains s2h.json). */
  root: string;
  /** Absolute path to s2h.json. */
  s2hJson: string;
  /** Absolute path to the harness deliverable directory. */
  harnessDir: string;
  /** Absolute path to harness/harness.json. */
  harnessJson: string;
  /** Absolute path to harness/AGENTS.md (the router/policy table). */
  agentsMd: string;
  /** Absolute path to harness/README.md. */
  harnessReadme: string;
  /** Absolute path to harness/sops/. */
  sopsDir: string;
  /** Absolute path to harness/sops/INDEX.md. */
  sopsIndex: string;
  /** Absolute path to harness/.pi/deepclause/. */
  dcDir: string;
  /** Absolute path to harness/.pi/deepclause/skills/. */
  dcSkillsDir: string;
  /** Absolute path to harness/.pi/deepclause/config.json. */
  dcConfig: string;
  /** Absolute path to .s2h/versions.json. */
  versionsJson: string;
  /** Absolute path to .s2h/sessions/. */
  sessionsDir: string;
}

export function projectPaths(root: string): ProjectPaths {
  const harnessDir = path.join(root, "harness");
  return {
    root,
    s2hJson: path.join(root, "s2h.json"),
    harnessDir,
    harnessJson: path.join(harnessDir, "harness.json"),
    agentsMd: path.join(harnessDir, "AGENTS.md"),
    harnessReadme: path.join(harnessDir, "README.md"),
    sopsDir: path.join(harnessDir, "sops"),
    sopsIndex: path.join(harnessDir, "sops", "INDEX.md"),
    dcDir: path.join(harnessDir, ".pi", "deepclause"),
    dcSkillsDir: path.join(harnessDir, ".pi", "deepclause", "skills"),
    dcConfig: path.join(harnessDir, ".pi", "deepclause", "config.json"),
    versionsJson: path.join(root, ".s2h", "versions.json"),
    sessionsDir: path.join(root, ".s2h", "sessions"),
  };
}
