# Harness Format

Defines what `s2h create` produces and what `s2h export` bundles. A harness is a
portable, versioned set of DML programs plus the metadata needed to run and
present them.

## 1. Directory layout

```
harness/
  harness.json                 # manifest: identity, router, skills, tools, runtime hints
  AGENTS.md                    # policy router table + human/agent instructions
  README.md                    # what the harness does, how to run/export it
  sops/                        # ingested source procedures (provenance)
    INDEX.md                   # source, hash, ingest time per file
    <slug>/...                 # original SOP content, normalised to Markdown
  .pi/deepclause/              # the DeepClause workspace (deepclause-pi conventions)
    config.json                # runtime limits + judgment defaults
    AGENTS.md                  # deepclause authoring guide (seeded)
    DML_REFERENCE.md           # DML language reference (seeded)
    skills/
      <slug>.dml               # one program per procedure
      dispatcher.dml           # optional custom router (ADR-0003)
    specs/                     # optional behaviour specs
    plans/                     # optional generated plans
```

`harness/.pi/deepclause/` is exactly the workspace `deepclause-pi` uses, so the
same directory is authored by pi and executed by the exported runtime. Do not
create `.deepclause/`; that name is rejected.

## 2. `harness.json`

The manifest is the single source of truth for identity, routing, and the
runtime contract. The authoring agent writes it; `s2h` validates it.

```jsonc
{
  "$schema": "https://sop2harness.dev/schema/harness-1.json",
  "schemaVersion": 1,
  "name": "who-anc",
  "title": "WHO Antenatal Care",
  "description": "Triage and care planning for routine antenatal contacts.",
  "version": "0.1.0",
  "createdWith": { "s2h": "0.1.0", "deepclausePi": "0.5.0", "deepclauseSdk": "0.0.89", "agentvm": "0.4.0" },
  "entry": null,
  "skills": [
    {
      "id": "anc-quick-check",
      "path": "skills/anc-quick-check.dml",
      "title": "Danger-sign quick check",
      "triggers": ["quick check", "danger sign", "triage", "refer?"],
      "effects": "none"
    },
    {
      "id": "anc-schedule",
      "path": "skills/anc-schedule.dml",
      "title": "ANC contact schedule",
      "triggers": ["schedule", "next visit", "how many contacts"],
      "effects": "none"
    }
  ],
  "runtime": {
    "tools": ["read_harness_file", "list_harness_files", "ask_user", "bash"],
    "compat": ["pi_workspace_list", "pi_bash"],
    "context": "turn",
    "gasLimit": 100000,
    "maxTokens": 16384,
    "streaming": true,
    "sandbox": {
      "provider": "agentvm",
      "enabled": true,
      "network": false,
      "allow": [],
      "mounts": { "/mnt/harness": "harness:ro" },
      "persistentRoot": false,
      "limits": { "timeoutMs": 120000, "maxOutputBytes": 200000 }
    }
  },
  "judgment": {
    "default": "llm",
    "jev": { "enabled": false, "model": "jev-latest", "apiKeyEnv": "TYPESAFE_API_KEY" }
  },
  "docs": ["README.md", "AGENTS.md", "sops/INDEX.md"]
}
```

### Field notes
- `entry` — optional path to a dispatcher DML for custom routing. When `null`,
  the host routes from `skills[].triggers` / the `AGENTS.md` table (ADR-0003).
- `skills[].effects` — `"none"` or a description of external state changes.
  Any non-`"none"` value requires `s2h export --allow-effects`.
- `runtime.tools` — the PHTC tools the harness calls (see §5). `bash` declares
  that the harness needs shell execution and therefore the AgentVM sandbox.
- `runtime.compat` — `deepclause-pi` tool names the harness also uses. The export
  provides compatible implementations.
- `runtime.sandbox` — required when `bash`/`pi_bash` is declared (ADR-0001).
  `provider: "agentvm"`; `network` defaults to `false`; `allow` is the egress
  firewall allowlist used only when `network` is true; `mounts` maps VM paths to
  harness-relative paths (`harness:ro` means read-only); `persistentRoot` is off
  by default; `limits` bound each command.
- `judgment` — mirrors `deepclause-pi`'s config; the exported runtime uses the
  same semantics (`llm` calibrated=false, `jev` calibrated=true via env key).
- `docs` — files the exported web app may display in its docs viewer. Every path
  must resolve inside the harness root.

Validation rules: unique skill ids; every `path` exists and ends in `.dml`;
if `entry` is set it must be listed in `skills`; every `docs` path exists;
`triggers` are non-empty for routable skills; `version` is valid semver; a shell
in `runtime.tools` requires `runtime.sandbox.enabled === true`.

## 3. DML conventions

Harnesses follow the `deepclause-pi` authoring guide and the `handbook-dml`
skill, with these s2h additions.

- **Entry point.** `agent_main(Request)` takes one natural-language request.
  Add `agent_main(_)` (or a typed fallback) that returns a static usage message.
- **Routing.** Routing lives in `AGENTS.md` and `harness.json.skills[].triggers`
  (ADR-0003); the host selects a skill. A `skills/dispatcher.dml` is optional and
  only needed for custom routing. If present it must never call another skill
  implicitly: it returns a route and the host runs the selected skill.
- **One procedure per skill.** Each skill is self-contained, names its SOP
  provenance in the header, and keeps deterministic Prolog to mechanical
  checks. Bounded classification/probability uses the judgment predicates;
  open-ended reasoning uses `prompt/N`; agentic, tool-using work uses `task/N`.
- **Typed outputs.** Use `string(...)`, `integer(...)`, `number(...)`,
  `boolean(...)`, `list(...)`, `object(...)` for model results.
- **Fallbacks.** Every deterministic gate has a model/judgment fallback; no
  hard failure on an incomplete case.
- **No pi-only assumptions.** Do not rely on `deepclause-pi` commands, the
  `dc_*` tools, `pi_agent_step`, or session imports. Runtime needs must be
  expressed as PHTC tools in the manifest.
- **Provenance.** The skill header records `SOP`, `Procedure / trigger`,
  `Effects`, and `Tools`, matching `harness.json`.

## 4. Router and `AGENTS.md`

`harness/AGENTS.md` is both human documentation and a machine-usable policy
table. It contains one row per skill:

```markdown
## Procedure routing

When a request matches a procedure below, run the mapped skill and report its
answer. Do not answer from memory or from the SOP text.

| Procedure / trigger | Skill (`harness.json` id) | Effects |
| --- | --- | --- |
| Danger signs at a contact | `anc-quick-check` | none |
| Visit schedule / next contact | `anc-schedule` | none |
```

The exported API routes from this table (mirrored in
`harness.json.skills[].triggers`) — deterministic trigger match first, then a
bounded `choose/4` judgment for ambiguous requests, then an optional dispatcher
DML (ADR-0003). The table and the manifest triggers must agree; `s2h` validates
this at create/export time.

## 5. Portable Harness Tool Contract (PHTC)

Host-neutral tools a harness may call. The exported runtime implements all of
them; the authoring session provides them through the compatibility adapter.

| Tool | Signature | Behaviour |
| --- | --- | --- |
| `read_harness_file` | `(path: string) -> { content: string }` | Read a UTF-8 file under the harness root. |
| `list_harness_files` | `(path: string) -> { entries: string[] }` | List one directory level under the root. |
| `ask_user` | `(prompt: string) -> { user_response: string }` | Ask the chat user one focused question. |
| `bash` | `(command: string)` or `(executable: string, args: string[])` | Run in the AgentVM sandbox (ADR-0001); disabled unless `runtime.sandbox.enabled`. |
| `http_fetch` (opt-in) | `(url: string) -> { status, body }` | Allowlisted domains only; off by default. |

Hard rules:
- All paths are relative and resolve inside the harness root (realpath +
  containment). Symlink escapes are rejected.
- Reads are byte/length bounded; the default limit is configurable.
- There are no write tools in the default contract.
- `bash` runs only inside the sandbox: network off by default, harness mounted
  read-only, timeout and output caps enforced by the runtime, not the guest.

### 5.1 Compatibility adapter (`deepclause-pi` names)

Harnesses may have been authored against `deepclause-pi`'s runtime tools. The
export therefore also accepts:

| pi tool | Export behaviour |
| --- | --- |
| `pi_workspace_list(path)` | Same as `list_harness_files`, root-confined. |
| `pi_bash(command)` | Runs in the AgentVM sandbox (ADR-0001). |
| `pi_bash(executable, args)` | Runs in the AgentVM sandbox as argv. |

New harnesses should call `read_harness_file`/`list_harness_files` directly and
declare the compat names only if needed. The authoring skill prefers PHTC.

## 6. Authoring and non-destructive updates

- `create` writes new skills with exclusive-create semantics.
- `--update` regenerates only files marked generated by `harness.json`
  (`skills[].generated !== false`), backing up the previous version under
  `.pi/deepclause/.backup/<timestamp>/`.
- User edits are kept: a skill the user marks `"generated": false` is read for
  context but never rewritten. New files are added; nothing is deleted without
  explicit confirmation.
- Every accepted create/update records the authoring session path in
  `.s2h/versions.json` at the next `commit`.

## 7. Minimal harness example

`harness.json` (trimmed):

```json
{
  "schemaVersion": 1,
  "name": "refund-desk",
  "version": "0.1.0",
  "skills": [
    { "id": "refund-policy", "path": "skills/refund-policy.dml", "title": "Refund eligibility", "triggers": ["refund", "return"], "effects": "none" }
  ],
  "runtime": { "tools": ["read_harness_file", "ask_user"], "context": "turn" }
}
```

`AGENTS.md` router rows (write one per skill):

```markdown
| Procedure / trigger | Skill (`harness.json` id) | Effects |
| --- | --- | --- |
| Refund / return eligibility | `refund-policy` | none |
```

`skills/refund-policy.dml`:

```prolog
% POLICY: refund-policy
% SOP: sops/refund-desk/README.md
% Effects: none

agent_main(Request) :-
    Request \= "",
    exec(read_harness_file(path: "AGENTS.md"), FileResult),
    get_dict(content, FileResult, Policy),
    format(string(Prompt),
        "Apply the refund policy below to this request. Store the decision and a short reason in Decision.\n\nPolicy:\n~w\n\nRequest: ~w",
        [Policy, Request]),
    task(Prompt, string(Decision)),
    answer(Decision).

agent_main(_) :-
    answer("Supply a request about refunds or returns.").
```

The host routes the request to `refund-policy` from the table and runs it. For a
harness that needs custom routing (for example, a multi-step decision tree), add
`skills/dispatcher.dml`, set `entry`, and return `route:<skill-id>`; the host then
runs that skill. Dispatchers are optional and never call other skills directly.
