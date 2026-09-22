---
name: s2h-authoring
description: Author or update a DeepClause DML harness from Standard Operating Procedures (SOPs) for sop2harness (s2h). Write one DML skill per procedure under .pi/deepclause/skills/, declare its triggers in harness.json, and add one router row per skill to the harness AGENTS.md policy table. Use when asked to turn SOPs into a harness, author or update harness skills, or write the harness router/manifest.
---

# s2h harness authoring

You are authoring an **s2h harness**. Your working directory is the harness
root, which contains `harness.json`, `AGENTS.md`, `sops/`, and
`.pi/deepclause/`. Before writing anything, read:

1. `.pi/deepclause/AGENTS.md` — DML authoring guide (authoritative for syntax).
2. `.pi/deepclause/DML_REFERENCE.md` — language reference.
3. `sops/INDEX.md` and the ingested SOP files under `sops/` — the procedures.

There is **no Markdown-to-DML compiler** and there must never be a
`.deepclause/` directory. Write valid DML directly.

## Harness layout (s2h conventions)

- `harness.json` — manifest; the single source of truth for identity, routing,
  tools, and limits. Keep it valid JSON and only use documented fields.
- `AGENTS.md` — the human/agent policy-routing table (one row per skill).
- `sops/` — ingested SOP sources (provenance). Do not edit SOP content here.
- `.pi/deepclause/skills/<slug>.dml` — one DML program per procedure.
- `.pi/deepclause/skills/dispatcher.dml` — optional custom router; normally
  omit it (host routing is used instead).

## Manifest shape

`harness.json` has this shape (keep exactly what exists, add only what is
needed):

```json
{
  "schemaVersion": 1,
  "name": "slug",
  "title": "Human title",
  "description": "One or two sentences.",
  "version": "0.1.0",
  "entry": null,
  "skills": [
    {
      "id": "slug",
      "path": "skills/slug.dml",
      "title": "Human title",
      "triggers": ["short trigger phrase", "another phrase"],
      "effects": "none",
      "generated": true
    }
  ],
  "runtime": {
    "tools": ["read_harness_file", "list_harness_files", "ask_user"],
    "compat": [],
    "context": "turn",
    "gasLimit": 100000,
    "maxTokens": 16384,
    "streaming": true
  },
  "judgment": {
    "default": "llm",
    "jev": { "enabled": false, "model": "jev-latest", "apiKeyEnv": "TYPESAFE_API_KEY" }
  },
  "docs": ["README.md", "AGENTS.md", "sops/INDEX.md"]
}
```

Rules:

- Skill `id`s are unique slugs. `path` is relative to `.pi/deepclause/` and
  must end in `.dml`.
- `triggers` are non-empty for every skill the host should route to. Each
  trigger is a short phrase in the *user's* wording.
- `effects` is `"none"` unless the skill changes external state; then write a
  short description.
- Add a skill to `runtime.tools` only if the DML actually calls that PHTC tool.
  Do not declare `pi_bash`, `pi_workspace_list`, `dc_*`, or any pi-only tool.
- `docs` must resolve to files inside the harness root; do not add paths that
  do not exist.

## Router table

`AGENTS.md` must contain a `## Procedure routing` section with exactly one data
row per routable skill. The second column is a backtick-wrapped skill id, and
the Effects column must equal the skill's `effects` value.

```markdown
## Procedure routing

When a request matches a procedure below, run the mapped skill and report its
answer. Do not answer from memory or from the SOP text.

| Procedure / trigger | Skill (`harness.json` id) | Effects |
| --- | --- | --- |
| Refund / return eligibility | `refund-policy` | none |
```

Keep the manifest `triggers` and the table in sync: same skill ids, same
effects, no missing or extra rows.

## DML conventions

- Entry point is `agent_main(Request)`; it takes one natural-language request.
- Add a static fallback clause that does **not** call the model:

```prolog
agent_main(_) :-
    answer("Supply a request about <procedure>.").
```

- Use the Portable Harness Tool Contract only: `read_harness_file(path: P)`,
  `list_harness_files(path: P)`, `ask_user(prompt: P)`. `bash` is allowed only
  when the manifest explicitly declares it and a sandbox is enabled — do not add
  shell steps unless the procedure truly requires them.
- Do not rely on `deepclause-pi` commands, `dc_*`, `pi_agent_step`, `pi_bash`,
  or session imports. The exported runtime has no pi.
- Record provenance in the header:

```prolog
% POLICY: <slug>
% SOP: sops/<slug>/<file>.md
% Procedure / trigger: <when to run>
% Effects: none
% Tools: read_harness_file, ask_user
```

- Bounded classification/probability uses the judgment predicates; open-ended
  reasoning uses `prompt/N`; agentic tool-using work uses `task/N`. Deterministic
  Prolog only for mechanical checks, and every deterministic gate needs a
  model/judgment fallback (no hard failure on an incomplete case).

## Workflow

1. Read the SOP files and decompose them by procedure. Propose a short
   section → skill map in your final report.
2. If a decision genuinely needs the user (scope, an ambiguous procedure, or a
   tool choice), call the `s2h_ask_user` tool with one focused question. In
   interactive mode it returns the user's answer; in headless mode it returns
   a default, so proceed autonomously.
3. Author one `.dml` skill per procedure.
4. Update `harness.json`: add each skill and keep the existing schema/fields.
5. Add one router row per skill to `AGENTS.md`.
6. Self-review against the rules above (fallback clause present, paths exist,
   triggers non-empty, effects match, no pi-only tools, no compiler output).
7. Do **not** create `.deepclause/`, do not delete user files, and do not
   overwrite a skill that already exists unless you are explicitly updating it.

When finished, report the skills you created or changed and the trigger/effects
you registered. The host runs deterministic validation after this turn.
