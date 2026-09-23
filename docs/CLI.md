# s2h CLI

Command and flag reference for `s2h`.

Install: `npm install -g deepclause-sop2harness` (the npm package is
`deepclause-sop2harness`; the command is `s2h`).

Status note: Phase 1 implemented `init`, `check`, `list`, and `status`.
Phase 2 implemented `create` (SOP ingestion + pi authoring session + validation).
Phase 3 implemented `commit` (semver bump, git commit/tag, version history).
Phase 4 implemented `export` (standalone API server generation).
Phase 5 implemented the exported web chat app and Docker image.
Phase 6 implemented the AgentVM sandbox for exported shell steps.
Phase 7 implemented the MCP server (per-skill tools + usage prompt).
The `test` helper (validate + diagram inspection + smoke runs) is implemented as
well.
The remaining commands are wired into the CLI with their documented options but
report "not implemented yet" until their roadmap phase lands.

## Global

```
s2h [command] [options]
s2h --help
s2h --version
```

`s2h` resolves the project root by walking up from the current directory until
it finds `s2h.json` or `harness/harness.json`. `init` always operates on the
current directory.

## `s2h init`

```
s2h init [--name <name>] [--model <provider/id>] [--force]
```

Scaffolds an s2h project in the current directory:

- Creates `s2h.json`, `.gitignore`, `.s2h/`, `harness/sops/`.
- Creates `harness/harness.json` (version `0.0.0`, empty skill list).
- Seeds `harness/.pi/deepclause/` with the `deepclause-pi` authoring guide,
  `DML_REFERENCE.md`, a default `config.json`, and a PHTC-oriented
  `skills/example.dml`.
- Initializes a git repository when none exists.

| Flag | Effect |
| --- | --- |
| `--name <name>` | Project/harness name. Defaults to a slug of the directory name. |
| `--model <provider/id>` | Default authoring model stored in `s2h.json`. |
| `--force` | Re-initialize, overwriting `s2h.json` and `harness/harness.json`. |

`init` is non-destructive: every other file is written with exclusive-create
semantics, so existing user files (including `.gitignore`, harness docs, SOPs,
and DeepClause workspace files) are never overwritten. Re-running `init` without
`--force` on an already-initialized project fails.

## `s2h create`

```
s2h create [request] [--file <path>...] [--name <slug>] [--update]
           [--model <provider/id>] [--context <mode>] [--headless] [--json] [--debug]
```

Authors (or, with `--update`, extends) a harness from a free-text request and/or
SOP source files.

Flow:

1. Ingest SOP inputs into `harness/sops/<slug>/` and update `sops/INDEX.md`
   (unchanged files are skipped).
2. Run one pi agent turn with `cwd = harness/`, the `deepclause-pi` extension,
   the `handbook-dml` skill, and the bundled `s2h-authoring` skill loaded.
   The agent may use `read`/`write`/`edit`/`grep`/`find`/`ls` only (no bash).
3. Validate the result with the same deterministic gate as `s2h check`.
4. Record the authoring session path under `.s2h/sessions/` for the next commit.

| Flag | Effect |
| --- | --- |
| `request` | Free-text description of the SOP/harness to build. |
| `--file <path>...` | SOP files or directories to ingest. |
| `--name <slug>` | Skill-set/SOP slug; defaults to the first input's base name. |
| `--update` | Regenerate generated skills (backs up `skills/` first); preserves user edits. |
| `--model <provider/id>` | Model override; otherwise `s2h.json`, then pi's default. |
| `--context <mode>` | Reserved for run context; authoring runs in a fresh turn. |
| `--headless` | Reserved for CI; create currently runs non-interactively. |
| `--json` | Emit NDJSON progress events. |
| `--debug` | Reserved for verbose authoring output. |

`create` leaves generated files in place for inspection when validation fails.

## `s2h test`

```
s2h test [--skill <id>] [--input <text>] [--mock] [--live] [--no-run]
         [--model <provider/id>]
```

Validates the harness, inspects the generated diagrams, and smoke-runs each
skill. Runs use the deterministic mock backend by default; `--live` uses a real
pi model.

| Flag | Effect |
| --- | --- |
| `--skill <id>` | Test a single skill. |
| `--input <text>` | Request text for the smoke run (defaults to the skill's first trigger). |
| `--mock` | Use the deterministic mock model backend (default). |
| `--live` | Use a real pi model backend. |
| `--no-run` | Validate and inspect diagrams only; skip smoke runs. |
| `--model <provider/id>` | Model for `--live` runs. |

## `s2h commit`

```
s2h commit [-m <message>] [--major|--minor|--patch] [--no-tag] [--dry-run]
```

Validates the harness, bumps `harness.json.version`, commits the harness, tags
it, and records the version in `.s2h/versions.json`.

Flow:

1. Run the deterministic validation gate; refuse to commit an invalid harness.
2. Bump the version (`--patch` is the default; `--major`/`--minor` are explicit).
3. Commit `s2h.json`, `.gitignore`, and `harness/` with the supplied or default
   message (`harness v<version>`).
4. Tag `v<version>` unless `--no-tag` is passed.
5. Append `{ version, commit, date, message, session }` to `.s2h/versions.json`
   and commit that record in a follow-up metadata commit (so the recorded hash
   is the real content-commit hash).

| Flag | Effect |
| --- | --- |
| `-m, --message <message>` | Commit message. Defaults to `harness v<version>`. |
| `--major` / `--minor` / `--patch` | Version bump. Patch is the default. |
| `--no-tag` | Skip creating the `v<version>` tag. |
| `--dry-run` | Print the plan without writing or committing. |

`commit` requires a git repository and, for tagging, a missing `v<version>`.
The authoring session recorded by `create` is referenced from the version entry
when available.

## `s2h export`

```
s2h export [--out <dir>] [--llm pi] [--sandbox none] [--no-mcp] [--no-web]
           [--allow-effects] [--port <n>]
```

Generates a standalone TypeScript API server plus a read-only copy of the
harness into the output directory (default `./export`).

Generated layout:

```
export/
  package.json          deepclause-sdk + pi-ai deps
  tsconfig.json
  src/
    server.ts           node:http API + SSE + static web app
    runtime.ts          deepclause-sdk wiring, sessions, cancellation
    backend.ts          bundled pi-ai LLM backend (mock backend via env)
    tools.ts            PHTC tools + path confinement
    harness.ts          manifest load + skill discovery
    router.ts           trigger routing
  web/
    index.html          chat page (vanilla JS/CSS, no build step)
    app.js              SSE chat, skills sidebar, docs viewer
    styles.css
  harness/              copy of the committed harness (read-only at runtime)
  .env.example
  Dockerfile            multi-stage node:22-slim, non-root, healthcheck
  docker-compose.yml
  README.md
  harness.lock.json     s2h/sdk versions + harness content hash
```

Endpoints: `/` (chat web app), `/healthz`, `/api/harness`, `/api/skills`,
`/api/docs`, `/api/docs/:name`, `POST /api/chat` (SSE),
`POST /api/sessions/:id/input`, `POST /api/sessions/:id/cancel`,
`DELETE /api/sessions/:id`.

| Flag | Effect |
| --- | --- |
| `--out <dir>` | Output directory. Defaults to `./export`. |
| `--llm <backend>` | `pi` is implemented; `openai-compatible` is a later phase. |
| `--sandbox <provider>` | `agentvm` (default when the harness needs shell) or `none` (reject shell). |
| `--no-mcp` | Omit the MCP server and its dependencies. |
| `--no-web` | Omit the web app and the Docker web layer. |
| `--allow-effects` | Required when any skill declares `effects` other than `none`. |
| `--port <n>` | Recorded in the generated `.env.example`. |

When the harness declares `bash`/`pi_bash`, the export includes
`deepclause-agentvm`, its WASM image, and a per-session sandbox. Shell runs
inside the VM with networking off by default, the harness mounted at
`/mnt/harness`, a scratch `/workspace` from `S2H_SANDBOX_DIR`, and per-command
timeout/output caps from `runtime.sandbox.limits`.

The export also serves the harness over MCP (ADR-0006): one tool per skill
(`<prefix>__<skill_slug>`, default prefix `s2h`) plus a `<prefix>__usage` prompt
that explains the harness and its routing table. Streamable HTTP at
`S2H_MCP_PATH` (default `/mcp`) plus a stdio entrypoint
(`node dist/mcp-stdio.js`).

Phase 7 does not yet implement tagged exports (`--tag`) or the
`openai-compatible` backend; those remain later phases.

Judge backends mirror the harness `judgment` block: `llm` wraps the active
model backend (uncalibrated), and `jev` (TypeSafe System One) is registered
only when `judgment.jev.enabled` is true and the key named by
`judgment.jev.apiKeyEnv` (default `TYPESAFE_API_KEY`) is present. If the
harness requests `jev` without a key, the runtime falls back to `llm`.

## `s2h check`

```
s2h check
```

Validates the harness deterministically without changing anything. Exit code is
`0` when valid and `1` when any check fails.

Checks performed:

- `harness.json` parses and matches the schema (`schemaVersion`, name, semver
  version, skills, runtime, judgment, docs).
- Skill ids are unique, paths resolve inside `.pi/deepclause/` and end in `.dml`.
- `entry`, when set, references a listed skill.
- Routable skills declare non-empty triggers.
- `AGENTS.md` router rows agree with `harness.json.skills[].triggers`/effects.
- `runtime.tools`/`runtime.compat` are valid; `bash`/`pi_bash` require an enabled
  AgentVM sandbox declaration.
- `docs` paths resolve inside the harness root.
- `harness/.deepclause/` is rejected (the correct workspace is `.pi/deepclause/`).
- Every `.dml` under `skills/` parses via `deepclause-sdk/compiler`.
- Every manifest skill has a static fallback clause (`agent_main(_) :- ...`).

## `s2h list`

```
s2h list [--json]
```

Lists skills from `harness.json`, SOP source files under `harness/sops/`
(excluding `sops/INDEX.md`), and committed versions from `.s2h/versions.json`.

## `s2h status`

```
s2h status [--json]
```

Shows project name/root/model, harness version and skill count, git branch and
working-tree state, and the last committed version.

## Planned commands

| Command | Roadmap phase | Status |
| --- | --- | --- |
| `s2h run` | 4 | stub |
| `s2h config` | planned helper | stub |
| `s2h doctor` | planned helper | stub |

Full behaviour for these is specified in [DESIGN.md](DESIGN.md).
