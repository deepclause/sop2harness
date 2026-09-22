# ADR-0002 — Bundle the pi-ai LLM adapter as the export default

- Status: accepted
- Date: 2026-09-22
- Deciders: sop2harness maintainers

## Context

`deepclause-sdk` drives all model work through an injectable `LLMBackend`
(`complete(request) -> { text, toolCalls, usage, providerData }`). The exported
harness needs one. The first design proposed an OpenAI-compatible HTTP client as
the default, with a `pi-ai` adapter as an option.

We already build on pi, and pi-ai (`@earendil-works/pi-ai`) provides provider
catalogs, credentials, streaming, tool-call mapping, usage, and provider state
replay. Reimplementing that surface as a bespoke OpenAI-compatible client
duplicates work and drifts from pi's behavior.

## Decision

The export **bundles the pi-ai adapter** as its default and primary LLM backend.
`deepclause-pi`'s `createPiBackend` is the reference shape; s2h provides an
equivalent adapter over `ModelRuntime`/`complete`.

- The generated server includes `@earendil-works/pi-ai` and resolves the model
  from `S2H_LLM_MODEL`/`S2H_LLM_PROVIDER` (default: a sensible small model).
- Credentials come from the same sources pi uses: provider environment variables
  or an injected `auth.json`. `s2h export` never copies credentials.
- A lightweight OpenAI-compatible backend remains available as an alternative
  (`S2H_LLM_BACKEND=openai-compatible`) for gateways and air-gapped/self-hosted
  deployments, but it is not the default.
- Judge backends stay as designed: `llm` wraps the active backend (uncalibrated)
  and `jev` uses `createJevJudgeBackend` when `TYPESAFE_API_KEY` is set.

## Consequences

- Model behavior in the export matches the authoring environment closely.
- The export depends on `@earendil-works/pi-ai` (already a peer of
  `deepclause-pi`), not on the full pi coding agent.
- Operators configure provider keys by name; `s2h doctor` can report which model
  and key the export will use without printing the key.
- The OpenAI-compatible path is retained because some deployments cannot reach
  provider APIs directly.

## Alternatives considered

1. **OpenAI-compatible only.** Smallest dependency surface, but reimplements
   provider auth, tool-call mapping, and streaming, and diverges from pi.
2. **Embed the full pi agent at runtime.** Unnecessary: exports run DML, not an
   agent loop. Adds the coding-agent surface and its tools to the trust boundary.
3. **No bundled backend (operator supplies one).** Maximum flexibility, but
   "ready to use" exports would not start.

## Follow-ups

- Pin the pi-ai adapter's provider-state replay behavior with tests against at
  least two providers.
- Document the supported `S2H_LLM_PROVIDER`/`S2H_LLM_MODEL` values.
