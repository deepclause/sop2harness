# ADR-0004 — Expose the exported harness as an MCP server

- Status: superseded by [ADR-0005](ADR-0005-single-mcp-run-tool.md)
- Date: 2026-09-22
- Deciders: sop2harness maintainers

> Superseded: the per-skill/helper tool and resource surface below was replaced
> by a single generic run tool. The transport, elicitation, progress and auth
> decisions were carried forward into ADR-0005.

## Context

The export exposes a REST/SSE API and a chat web app. MCP clients (Claude
Desktop, Cursor, IDEs, other agents) should be able to call the same harness
skills with typed tools, without a bespoke HTTP client. The MCP TypeScript SDK
(`@modelcontextprotocol/sdk`, observed 1.25.3) provides tool/resource/prompt
registration, elicitation, progress notifications, and stdio + Streamable HTTP
transports. The runtime that executes skills already exists for the REST API.

## Decision

Every exported harness also exposes an **MCP server**, enabled by default. It
reuses the same harness runtime; it is a second surface, not a replacement for
the REST API.

- **Transports.**
  - **Streamable HTTP** at `S2H_MCP_PATH` (default `/mcp`) on the existing HTTP
    server, sharing `S2H_API_TOKEN` for bearer auth.
  - **stdio** via a dedicated entrypoint (`s2h mcp` locally; `node
    dist/mcp-stdio.js` in the image) for desktop clients that spawn a process.
- **Tools.**
  - One tool per manifest skill: `<prefix>__<skill_slug>` (default prefix
    `s2h`, slug = skill id with non-alphanumerics replaced by `_`). Input
    `{ message, sessionId?, answer?, context? }`; output text is the harness
    answer, with `structuredContent` `{ skill, answer, route, usage }`.
  - `s2h__route`: run only the router and return `{ skill, reason, confidence }`.
  - `s2h__list_skills`: the manifest skill list.
  - `s2h__read_doc`: read an allowlisted doc by path.
- **Resources.** `harness://manifest` (JSON) and `harness://docs/<path>`
  (Markdown) for the manifest's `docs` allowlist and `sops/`. Resource reads use
  the same root confinement and size caps as the REST docs endpoint.
- **Prompts.** Deferred. A later ADR may add one prompt per skill; the initial
  surface is tools + resources.
- **`ask_user` mapping.** Prefer MCP elicitation: the server calls
  `elicitInput({ message, requestedSchema })` and resumes the run with the
  answer. When the client does not support elicitation, the tool returns
  `structuredContent` with `inputRequired: true`, the question, and a
  `sessionId`; the client re-invokes the same tool (or `s2h__resume`) with
  `{ sessionId, answer }` to continue. Session slots are in-memory and
  short-lived.
- **Progress and cancellation.** Map DML `task_activity`/`tool_call` to MCP
  `notifications/progress` when the client supplied a progress token. Honor the
  tool callback's `signal` for cancellation. The final `answer` becomes the tool
  result.
- **Exposure boundary.** Only manifest-listed skills and allowlisted docs are
  exposed. Identical limits, sandbox rules, and read-only defaults as the REST
  API. Streamable HTTP requires the bearer token; stdio is trusted-local.
- **Configuration.** `S2H_MCP_ENABLED` (default true), `S2H_MCP_PATH`,
  `S2H_MCP_TRANSPORT` (`http`, `stdio`, or `both`), `S2H_MCP_TOOL_PREFIX`,
  `S2H_MCP_MAX_SESSIONS`.

## Consequences

- Any MCP-capable client gets typed harness tools and docs with no custom code.
- Two public surfaces must stay consistent; both are generated from the same
  manifest and share the runtime, session slots, limits, and sandbox.
- MCP tool names are constrained (no slashes), so skill ids are normalized and
  prefixed; the prefix is configurable to avoid collisions across servers.
- Elicitation support varies by client, so the `inputRequired` fallback is part
  of the contract and must be tested.
- The MCP SDK becomes an export dependency and must be version-pinned.

## Alternatives considered

1. **REST-only.** Simpler, but MCP clients cannot discover or call skills.
2. **stdio-only.** Good for desktop, not for remote/shared deployments.
3. **A single generic `s2h__run` tool with a `skill` argument.** Fewer tools,
   but clients lose per-skill discovery, descriptions, and schemas.
4. **Make MCP the primary surface and drop REST.** Loses browser/curl access and
   the existing web app path.

## Follow-ups

- Finalize tool names, titles, descriptions, and input/output schemas.
- Define `s2h__resume` versus re-invoking the skill tool for the elicitation
  fallback.
- Decide whether MCP prompts (one per skill) are worth adding.
- Evaluate MCP OAuth for the Streamable HTTP transport in shared deployments.
- Add MCP conformance/integration tests with a client harness.
