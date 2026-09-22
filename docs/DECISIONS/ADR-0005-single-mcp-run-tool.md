# ADR-0005 — One generic MCP run tool that streams progress

- Status: accepted
- Date: 2026-09-22
- Supersedes: ADR-0004 (tool/resource surface)
- Deciders: sop2harness maintainers

## Context

ADR-0004 exposed one MCP tool per harness skill, plus `route`, `list_skills` and
`read_doc` tools, plus docs/SOP resources. That is more surface than the use case
needs. The router already decides which skill to run, the chat/API clients only
want "run the harness", and every extra tool adds schema and description tokens
to every MCP client's context and complicates client configuration. The MCP
protocol also returns a tool call as a single result, so per-skill tools do not
make streaming better.

## Decision

The exported harness exposes **exactly one generic MCP tool** that runs the
harness end-to-end and streams progress back to the client.

- **Tool name:** `<prefix>__run` (default `s2h__run`), configurable with
  `S2H_MCP_TOOL_PREFIX` / `S2H_MCP_TOOL_NAME`.
- **Input:** `{ message: string, skill?: string, sessionId?: string, context?: "turn"|"branch"|"isolated" }`.
  `skill` is an optional override; otherwise the host routes.
- **Output:** the harness answer as text, plus `structuredContent
  { harness, version, skill, route: { skill, reason }, answer, usage,
  inputRequired?, sessionId? }`.
- **Description:** generated from `harness.json` so a model can decide when to
  call it: harness title/version, the procedure triggers and their skill titles,
  and the effects summary. No per-skill tools.
- **Streaming:** if the client supplies a progress token
  (`extra._meta.progressToken`), the server emits `notifications/progress` for
  the route decision, `task_activity`/`tool_call` activity, and streamed model
  text. The final answer is the tool result. Clients without progress support
  still receive the final answer; there is no partial result protocol.
- **Cancellation:** the tool callback's `extra.signal` aborts the run (same path
  as `/api/sessions/:id/cancel`). One active run per MCP session.
- **`ask_user`:** MCP elicitation when supported, otherwise the tool returns
  `inputRequired: true` + `sessionId` and the client re-invokes `s2h__run` with
  `{ sessionId, answer }`.
- **Transports, auth, limits, sandbox, read-only defaults:** unchanged from
  ADR-0004 — Streamable HTTP at `/mcp` (bearer `S2H_API_TOKEN`) and a stdio
  entrypoint.
- **No resources and no helper tools** in v1. The manifest description on the
  single tool carries discovery; docs remain available over the REST API and the
  web app.

## Consequences

- Minimal, stable MCP surface: one tool to configure, describe, and test.
- Clients cannot discover per-skill input schemas separately; the harness
  contract is "send a natural-language request" (all skills share
  `agent_main(Request)`), which matches the DML convention.
- "Streaming" means progress notifications during the call plus a final result,
  not a chunked tool response. This is the MCP-supported shape.
- Long runs are bounded by `S2H_RUN_TIMEOUT_MS`; resumable long-running MCP
  tasks (the SDK's tasks API) are a future option, not v1.

## Alternatives considered

1. **Per-skill tools + helper tools + resources (ADR-0004).** More discoverable,
   but larger context cost and more surface to maintain.
2. **One tool plus resources for docs.** Reasonable later; not needed for
   "run the harness".
3. **Use the MCP tasks API for true streaming/resumability.** More faithful
   long-run streaming, but limited client support; revisit if needed.
4. **No MCP, REST only.** Loses typed MCP client integration.

## Follow-ups

- Finalize the generated tool description template from `harness.json`.
- Decide whether a future `s2h__info` tool (manifest/docs) is worth adding.
- Evaluate MCP tasks for long-running harnesses.
- Add MCP conformance tests (progress, elicitation, fallback, cancellation).
