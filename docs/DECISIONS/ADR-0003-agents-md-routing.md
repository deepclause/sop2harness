# ADR-0003 — Host-side routing from the harness `AGENTS.md` policy table

- Status: accepted
- Date: 2026-09-22
- Deciders: sop2harness maintainers

## Context

A harness exposes several skills. An incoming chat request must be routed to the
right one. The first design made a generated `dispatcher.dml` the required entry
point, with an optional host-side manifest router.

Routing is also useful to *external* agents: pi, a chat host, or another service
can read a plain policy table and decide which skill to call, without running a
dispatcher program. `deepclause-pi` already established this pattern: a repo
`AGENTS.md` holds a policy-routing table that maps user wording to a skill and
args, and pi follows it.

## Decision

Routing is defined by the harness's **`AGENTS.md` policy table**, mirrored in
machine-readable form by `harness.json.skills[].triggers`. The exported server
routes from that table; a dispatcher DML is optional, not required.

- `s2h create` writes one `AGENTS.md` row per skill (trigger → skill id →
  effects) and keeps `harness.json` triggers in sync.
- The exported runtime resolves the router in this order:
  1. **Deterministic match** on `triggers` (normalized substring/keyword).
  2. **Bounded judgment** `choose/4` over the candidate skills when there is no
     single deterministic match or the request is ambiguous — using the
     configured judge backend.
  3. **Optional dispatcher DML** (`harness.json.entry`, if present) for harnesses
     that need custom routing logic.
  4. **Clarify** with the user (`ask_user`) when still unresolved.
- The server emits a `route` SSE event with the chosen skill, the reason
  (`trigger`/`judgment`/`dispatcher`), and the confidence when available.
- `AGENTS.md` remains the human- and agent-readable source of truth; the server
  reads `harness.json` for speed and falls back to parsing the table so the two
  cannot silently diverge (a validation error is raised at export/create time if
  they do).

## Consequences

- One router definition serves the web app, external agents, and any future chat
  host; no separate dispatcher to author for the common case.
- The bounded `choose/4` judgment keeps routing cheap and constrained to the
  declared skill set, instead of a free-form agent turn.
- Harnesses that need non-trivial routing can still ship a dispatcher DML, and
  the same manifest/table contract applies.
- Validation must enforce table ↔ manifest agreement.

## Alternatives considered

1. **Dispatcher DML required.** Fully custom routing, but every harness must
   write routing code and the router is opaque to external agents.
2. **Host-side manifest only (no AGENTS.md).** Machine-readable but loses the
   human/pi-readable policy table that `deepclause-pi` already uses.
3. **Free-form model router.** Most flexible, least predictable, and allows the
   model to route outside the declared skill set.

## Follow-ups

- Specify the `AGENTS.md` table grammar and the `harness.json` ↔ table validator.
- Define tie-breaking and confidence thresholds for the judgment router.
