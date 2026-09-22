# Testing

`s2h` tests are written with [vitest](https://vitest.dev/) and run with
`npm test`. Phase 1 covers the deterministic core: no model calls, no network.

## Layout

```
tests/
  semver.test.ts     version string validation and version bumps
  router.test.ts     harness AGENTS.md policy-table parsing
  validate.test.ts   deterministic harness validation gate
  init.test.ts       s2h init scaffolding + post-init validation
  ingest.test.ts     SOP ingestion, normalisation, and idempotent re-ingest
  request.test.ts    authoring request construction
  create.test.ts     create command guards
  commit.test.ts     version bump, git commit/tag, versions.json recording
  export.test.ts     export skeleton generation and guard rails
```

## What is covered

- **Semver** — plain, pre-release, and build versions are accepted; malformed
  strings are rejected.
- **Router parsing** — only backtick-wrapped skill rows become routing rows;
  placeholder rows and prose are ignored.
- **Validation** — a valid fixture harness passes; missing fallback clauses,
  router/manifest disagreement, shell tools without a sandbox declaration, and
  DML parse failures (including SWI-Prolog errors the SDK validator misses) all
  fail.
- **Init** — a fresh `s2h init` produces a harness that passes `s2h check`, and
  re-initializing without `--force` is refused.
- **Ingestion** — Markdown is normalised, indexed, and re-ingested idempotently;
  directories are ingested recursively.
- **Create guards** — `create` refuses to run without a request or `--file`.
- **Commit** — dry-run makes no changes; a real commit bumps the harness
  version, creates the tag, records the real content-commit hash in
  `.s2h/versions.json`, and leaves the working tree clean.
- **Export** — generates the server/harness skeleton, web chat app, Dockerfile,
  compose file, and `harness.lock.json`; `--no-web` omits the web layer, and
  shell-needing harnesses are refused in Phase 5.

## Future phases

Later phases add the test groups described in [DESIGN.md](DESIGN.md): golden
authoring fixtures with a mock LLM backend, export integration tests against a
running server, security/traversal tests, Docker smoke tests, and sibling
contract tests that pin the `deepclause-pi`/`deepclause-sdk` surfaces.
