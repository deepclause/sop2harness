# AGENTS.md — sop2harness

Working guide for agents and contributors. **Read this first, then follow the
documentation index below.**

## Purpose

`sop2harness` (`s2h`) is a CLI that turns Standard Operating Procedures into a
runnable, versioned **harness** of DeepClause DML programs, and exports that
harness as a self-hosted API + chat web app + Docker image.

Authoring intelligence is **pi** (with the `deepclause-pi` extension). The
artifact is **DML** (valid today, no compiler). The export is a standalone
Node runtime built on `deepclause-sdk`.

Sibling projects (do not fork, depend on them):

- `../deepclause-sdk` — DML runtime, semantic judgment predicates, compiler/validator.
- `../deepclause-pi` — pi extension: `.pi/deepclause/` workspace, `/dc-*` commands, `dc_run`, diagrams, handbook authoring skill.

## Documentation index

Update this table whenever a document is added, renamed, or removed. This is the
single entry point to the project's design.

| Document | Description | Status |
| --- | --- | --- |
| [README.md](README.md) | Project overview and command sketch | current |
| [AGENTS.md](AGENTS.md) | This working guide and documentation index | current |
| [docs/DESIGN.md](docs/DESIGN.md) | Vision, goals, architecture, CLI, flows, security, roadmap, open questions | current |
| [docs/HARNESS_FORMAT.md](docs/HARNESS_FORMAT.md) | Harness project layout, `harness.json` schema, DML conventions, runtime tool contract | current |
| [docs/EXPORT_RUNTIME.md](docs/EXPORT_RUNTIME.md) | Exported API, web chat, Docker image, configuration and security | current |
| [docs/DECISIONS/ADR-0001-sandboxed-bash-via-agentvm.md](docs/DECISIONS/ADR-0001-sandboxed-bash-via-agentvm.md) | Sandboxed bash in exports via `deepclause-agentvm` | accepted |
| [docs/DECISIONS/ADR-0002-bundle-pi-adapter.md](docs/DECISIONS/ADR-0002-bundle-pi-adapter.md) | Bundle the pi-ai adapter as the export LLM backend | accepted |
| [docs/DECISIONS/ADR-0003-agents-md-routing.md](docs/DECISIONS/ADR-0003-agents-md-routing.md) | Host-side routing from the harness `AGENTS.md` policy table | accepted |

Planned documents (add a link here when written):

- `docs/CLI.md` — full command and flag reference.
- `docs/SECURITY.md` — threat model, path confinement, secrets, deployment hardening.
- `docs/TESTING.md` — unit, integration, golden, and Docker smoke tests.
- `docs/ROADMAP.md` — milestone tracking (may stay a section of `DESIGN.md` initially).

## Accepted decisions

These are binding for the design unless superseded by a new ADR:

1. **Sandboxed bash via AgentVM (ADR-0001).** Exported harnesses may run shell
   commands inside a `deepclause-agentvm` sandbox. It is opt-in per harness,
   network-off and read-only by default, and treated as defense in depth rather
   than a hard trust boundary.
2. **Bundled pi-ai adapter (ADR-0002).** The export's default and primary LLM
   backend reuses `@earendil-works/pi-ai`. An OpenAI-compatible backend remains
   an alternative.
3. **`AGENTS.md` routing (ADR-0003).** Routing is defined by the harness
   `AGENTS.md` policy table, mirrored in `harness.json.skills[].triggers`; a
   dispatcher DML is optional.

## Working rules

- **Docs first.** Change or add a design doc before or with the code. Keep the
  index above current; never link a document that does not exist.
- **Stay in the design phase until told otherwise.** This repository currently
  holds design only. Do not scaffold runtime code without an explicit request.
- **Do not fork the siblings.** Use `deepclause-pi` for authoring and
  `deepclause-sdk` for the export runtime. If a capability is missing, record it
  as an open question or an ADR, then extend the sibling deliberately.
- **No compiler.** The harness is authored DML that already parses. `s2h` never
  invokes a Markdown-to-DML compiler and never creates `.deepclause/`.
- **Non-destructive authoring.** `create` and `commit` must never silently
  overwrite user edits. Regeneration is explicit (`--update`/`--force`) and
  preserves a diffable backup.
- **Security defaults.** Export is read-only by default. File access is
  confined to the harness root. Shell runs only inside the opt-in
  `deepclause-agentvm` sandbox (network off, read-only harness mount); the
  exported API process never executes host shell. Secrets come only from the
  environment and are never written into the harness or the export.
- **Determinism where it matters.** Prefer deterministic validation (parse,
  manifest, path checks) over model judgment for gates that must not be wrong.
  Use semantic judgments for bounded classification/probability, and `task/N`
  only when the work is genuinely agentic (see the `handbook-dml` skill).
- **Keep the artifact portable.** Harness DML should target the harness runtime
  contract in [docs/HARNESS_FORMAT.md](docs/HARNESS_FORMAT.md), not pi-only
  internals. pi-specific tools are a compatibility layer, not a requirement.

## Domain vocabulary

- **SOP** — a source procedure document (Markdown, PDF, DOCX, HTML, or text).
- **Harness** — the versioned deliverable: DML programs + docs + `harness.json`.
- **Skill** — one DML workflow program under `.pi/deepclause/skills/`.
- **Dispatcher** — the harness entry skill that routes a request to a skill.
- **Export** — a generated standalone server + web app + Dockerfile that runs a
  committed harness.
- **Portable Harness Tool Contract (PHTC)** — the small, host-neutral tool set a
  harness may rely on at runtime.

## Layout of this repository

```
sop2harness/
  README.md
  AGENTS.md            # this file: working guide + documentation index
  docs/
    DESIGN.md
    HARNESS_FORMAT.md
    EXPORT_RUNTIME.md
  # implementation added later:
  # src/               CLI (init/create/commit/export)
  # src/authoring/      pi session embedding + SOP ingestion
  # src/export/         export generator + runtime templates
  # templates/          Dockerfile, web app, server templates
  # tests/              unit + integration + golden + docker smoke
```
