# s2h CLI

Command and flag reference for `s2h`.

Status note: Phase 1 implements `init`, `check`, `list`, and `status`. The other
commands are wired into the CLI with their documented options but report
"not implemented yet" until their roadmap phase lands.

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
| `s2h create` | 2 | stub |
| `s2h commit` | 3 | stub |
| `s2h export` | 4 | stub |
| `s2h run` | 4 | stub |
| `s2h config` | planned helper | stub |
| `s2h doctor` | planned helper | stub |

Full behaviour for these is specified in [DESIGN.md](DESIGN.md).
