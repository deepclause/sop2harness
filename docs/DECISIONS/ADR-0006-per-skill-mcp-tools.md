# ADR-0006 — MCP exports one tool per skill plus a usage prompt

- Status: accepted
- Date: 2026-09-22
- Supersedes: ADR-0005 (single generic run tool)
- Deciders: sop2harness maintainers

## Context

ADR-0005 reduced the MCP surface to one generic `s2h__run` tool. In practice,
MCP clients lose per-skill discovery: every skill shares the same natural-language
contract, so a client model has to read the routing table from a description or a
separate resource before it knows which procedures exist.

The export already knows the skill list from `harness.json`. Exposing that list
as typed tools is the more natural MCP shape and matches how the harness is
described in its `AGENTS.md` policy-routing table.

## Decision

Every export exposes, over MCP:

1. **One tool per harness skill.**
   - Name: `<prefix>__<skill_slug>` (default prefix `s2h`; skill id is slugified).
   - Title: the skill's `title`.
   - Description: the skill's title, triggers, and effects.
   - Input: `{ message: string, sessionId?: string }`.
   - Output: the skill's answer text plus
     `structuredContent { harness, version, skill, answer }`.
   - Annotations: `readOnlyHint: true` unless the skill declares effects;
     `openWorldHint: false`.
   - Each tool runs the skill through the same runtime used by the chat API.

2. **One usage prompt.**
   - Name: `<prefix>__usage`.
   - Returns a general explanation of the harness and the routing table mapping
     procedure triggers to the per-skill tools.

The single generic `s2h__run` tool is removed. Progress notifications and
elicitation remain best-effort follow-ups on the per-skill tools.

## Consequences

- MCP clients get typed, discoverable procedures without reading the harness docs.
- Tool names are constrained to `[A-Za-z0-9_]`, so skill ids are slugified.
- The usage prompt is the human/model-facing routing table; the tools are the
  executable surface.
- More tools means more context tokens for clients that auto-load all tools; the
  usage prompt exists to keep that cost intentional.

## Alternatives considered

1. **Single `s2h__run` tool (ADR-0005).** Minimal surface, but no per-skill
   discovery or typed contracts.
2. **Per-skill tools plus resources for docs (ADR-0004).** Richer, but the usage
   prompt covers discovery without a resource surface.
3. **No MCP.** Loses typed client integrations.

## Follow-ups

- Re-add progress notifications and elicitation to the per-skill tools.
- Decide whether the usage prompt should also be emitted as MCP `server.instructions`.
