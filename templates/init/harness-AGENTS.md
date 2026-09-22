# {{name}} harness

This harness turns the Standard Operating Procedures under `sops/` into runnable
DeepClause DML skills. Author it with `s2h create`, validate it with `s2h check`,
and export it with `s2h export`.

## DeepClause policy routing

When a request matches a procedure below, do **not** answer from memory or from
the SOP text. Call the `dc_run` tool with the mapped skill and args, then report
its answer.

| Procedure / trigger | Skill (`dc_run.skill`) | Args (`dc_run.args`) |
| --- | --- | --- |
| _(no procedures yet — add skills with `s2h create`)_ | | |
