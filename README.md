# sop2harness (`s2h`)

Turn Standard Operating Procedures (SOPs) into a runnable, versioned **harness**:
a set of validated DeepClause DML programs plus the docs and manifest needed to
run them, and to export them as a small self-hosted API and chat web app.

`s2h` is a CLI. Its `create` command drives a normal **pi** agent session with the
**deepclause-pi** extension loaded, so the authoring intelligence is pi and the
runtime artifact is DML. `commit` versions the harness; `export` produces a
ready-to-run API, web chat, MCP server, and Docker image.

The exported app routes requests from the harness `AGENTS.md` policy table
(mirrored in `harness.json`), reads harness docs, and runs read-only by default.
When a harness declares shell steps, they run inside the opt-in
**deepclause-agentvm** WASM Linux sandbox (network off by default). Decisions are
recorded in [docs/DECISIONS/](docs/DECISIONS/).

> Status: **Phases 1–5 implemented.** `init`, `check`, `list`, `status`,
> `create`, `commit`, and `export` are working, and the export includes a chat
> web app and Docker image. Sandbox, MCP, and hardening follow. Start with the
> design docs.

## Commands (target)

```bash
s2h init                                  # scaffold a harness project
s2h create "Turn this SOP into a harness" # or: s2h create --file ./sop.md
s2h commit -m "add triage workflow"      # version the harness
s2h export --out ./export                # API + web app + Dockerfile
```

Planned helpers: `s2h run`, `s2h config`, `s2h doctor`. See
[docs/DESIGN.md](docs/DESIGN.md) and [docs/CLI.md](docs/CLI.md).

## Design documents

| Document | Contents |
| --- | --- |
| [docs/DESIGN.md](docs/DESIGN.md) | Vision, architecture, CLI, create/commit/export flows, security, roadmap |
| [docs/CLI.md](docs/CLI.md) | Command and flag reference |
| [docs/TESTING.md](docs/TESTING.md) | Test layout and how to run the suite |
| [docs/HARNESS_FORMAT.md](docs/HARNESS_FORMAT.md) | Harness layout, `harness.json`, DML conventions, runtime tool contract |
| [docs/EXPORT_RUNTIME.md](docs/EXPORT_RUNTIME.md) | Exported API, web chat, Docker image, configuration, security |

[AGENTS.md](AGENTS.md) is the working guide for agents and contributors and keeps
the documentation index.

## Relationship to sibling projects

```
deepclause-sdk   the DML runtime + semantic judgment layer
deepclause-pi    the pi extension: authoring guide, /dc-* commands, dc_run, diagrams
sop2harness      this project: SOP -> harness CLI, versioning, export
```

`s2h` depends on `deepclause-pi` (authoring) and `deepclause-sdk` (export
runtime). It does not fork either.
