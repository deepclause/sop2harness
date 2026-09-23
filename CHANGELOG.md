# Changelog

## 0.0.1 — 2026-09-23

First public release of the `deepclause-sop2harness` npm package (command: `s2h`).

- `s2h init` — scaffold a harness project (manifest, docs, DeepClause workspace).
- `s2h create` — ingest SOPs and author one DML skill per procedure via a pi agent
  session, with deterministic validation and generated diagrams.
- `s2h test` — validate, inspect diagrams, and smoke-run skills (mock by default,
  `--live` for a real model).
- `s2h check` / `s2h list` / `s2h status` — deterministic validation and inspection.
- `s2h commit` — semver bump, git commit/tag, and version history.
- `s2h export` — standalone API server, web chat, MCP server (one tool per skill
  plus a usage prompt), Docker image, and the opt-in AgentVM sandbox.
- `run`, `config`, and `doctor` are wired into the CLI with their documented
  options but are not implemented yet.

See [README.md](README.md) and [docs/CLI.md](docs/CLI.md).
