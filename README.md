# sop2harness (`s2h`)

**Turn a Standard Operating Procedure into a runnable, versioned DeepClause harness.**

`s2h` is a CLI that converts SOPs (Markdown, PDF, DOCX, HTML, or text) into
validated [DML](docs/HARNESS_FORMAT.md) programs — one skill per procedure —
plus the manifest, router table, and docs needed to run them. One command then
exports the harness as a self-hosted API, chat web app, MCP server, and Docker
image.

The authoring intelligence is **pi** (with the `deepclause-pi` extension). The
runtime artifact is **DML** on `deepclause-sdk`: deterministic Prolog workflow
logic with bounded LLM/judgment leaves, so the harness is **robust, reliable,
responsible, and auditable** — designed for heavily regulated industries.

## Status

Phases 1–7 are implemented: `init`, `check`, `list`, `status`, `create`,
`commit`, `export`, plus the export's web chat, Docker image, AgentVM sandbox,
and MCP server. Hardening is ongoing.

## Install

The npm package is `deepclause-sop2harness`; the command is `s2h`.

```bash
npm install -g deepclause-sop2harness   # installs the s2h command
s2h --version
```

Without installing, run it with `npx deepclause-sop2harness --help`.

## Quick start

```bash
# Scaffold a harness project
s2h init --name "support-triage"

# Author a harness from an SOP (and generate diagrams)
s2h create "Turn this SOP into a harness." --file ./procedure.md

# Inspect and smoke-test before running
s2h test              # validate + diagram inspection + mock smoke runs
s2h test --live       # run skills with a real pi model

# Version it
s2h commit -m "add triage workflow"

# Export a self-hosted runtime
s2h export --out ./export
cd export && npm install && npm run build && npm start
```

Open `http://localhost:8080/` for the chat app, or point an MCP client at
`/mcp`.

## Commands

| Command | What it does |
| --- | --- |
| `s2h init` | Scaffold a harness project |
| `s2h create` | Author/update harness skills from SOPs via a pi agent session |
| `s2h test` | Validate, inspect diagrams, and smoke-run skills |
| `s2h check` | Deterministic validation without changes |
| `s2h commit` | Version, commit, tag, and record history |
| `s2h export` | Generate the API + web app + MCP + Docker runtime |
| `s2h list` / `s2h status` | Inspect skills, SOPs, versions, and git state |

See [docs/CLI.md](docs/CLI.md) for the full reference.

## What a harness looks like

```
harness/
  harness.json            # manifest: identity, skills, triggers, tools, limits
  AGENTS.md               # policy-routing table for hosts and humans
  sops/                   # ingested SOP sources (provenance)
  .pi/deepclause/
    skills/<slug>.dml     # one DML program per procedure
    diagrams/             # presentation + specification Mermaid diagrams
```

DML keeps deterministic logic in Prolog and uses bounded LLM/judgment leaves
only for classification, extraction, and synthesis. Every skill has a static
fallback; every deterministic gate falls back instead of failing silently.

## Security defaults

- Export is read-only by default (`--allow-effects` opts into writes).
- File access is root-confined and symlink-checked.
- Shell steps run inside the opt-in `deepclause-agentvm` sandbox (network off).
- Secrets come only from environment variables; never baked into images.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/DESIGN.md](docs/DESIGN.md) | Vision, architecture, CLI, flows, security, roadmap |
| [docs/CLI.md](docs/CLI.md) | Command and flag reference |
| [docs/HARNESS_FORMAT.md](docs/HARNESS_FORMAT.md) | Harness layout, `harness.json`, DML conventions |
| [docs/EXPORT_RUNTIME.md](docs/EXPORT_RUNTIME.md) | Exported API, web app, Docker, MCP, configuration |
| [docs/TESTING.md](docs/TESTING.md) | Test layout and how to run the suite |
| [docs/DECISIONS/](docs/DECISIONS/) | Architecture decision records |

[AGENTS.md](AGENTS.md) is the working guide for agents and contributors.

## Relationship to sibling projects

```
deepclause-sdk    DML runtime + semantic judgment layer
deepclause-pi     pi extension: authoring guide, /dc-* commands, diagrams
sop2harness       this project: SOP -> harness CLI, versioning, export
```

`s2h` depends on `deepclause-pi` (authoring) and `deepclause-sdk` (runtime). It
does not fork either.
