# Testing

`s2h` tests are written with [vitest](https://vitest.dev/) and run with
`npm test`. Phase 1 covers the deterministic core: no model calls, no network.

## Layout

```
tests/
  semver.test.ts     version string validation
  router.test.ts     harness AGENTS.md policy-table parsing
  validate.test.ts   deterministic harness validation gate
  init.test.ts       s2h init scaffolding + post-init validation
```

## What is covered

- **Semver** — plain, pre-release, and build versions are accepted; malformed
  strings are rejected.
- **Router parsing** — only backtick-wrapped skill rows become routing rows;
  placeholder rows and prose are ignored.
- **Validation** — a valid fixture harness passes; missing fallback clauses,
  router/manifest disagreement, and shell tools without a sandbox declaration
  all fail.
- **Init** — a fresh `s2h init` produces a harness that passes `s2h check`, and
  re-initializing without `--force` is refused.

## Future phases

Later phases add the test groups described in [DESIGN.md](DESIGN.md): golden
authoring fixtures with a mock LLM backend, export integration tests against a
running server, security/traversal tests, Docker smoke tests, and sibling
contract tests that pin the `deepclause-pi`/`deepclause-sdk` surfaces.
