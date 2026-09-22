# {{name}} harness

A runnable, versioned harness of DeepClause DML programs.

- **Skills** live in `.pi/deepclause/skills/`.
- **Routing** is defined by the table in `AGENTS.md` and mirrored in `harness.json`.
- **Sources** live under `sops/`.

## Commands

```bash
s2h check        # validate the harness
s2h list         # list skills and SOPs
s2h create "..." # author skills from SOPs
s2h export       # generate the API + web app + Docker image
```
