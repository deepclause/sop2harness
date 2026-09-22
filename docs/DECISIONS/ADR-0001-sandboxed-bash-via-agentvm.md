# ADR-0001 — Sandboxed bash in exported harnesses via AgentVM

- Status: accepted
- Date: 2026-09-22
- Deciders: sop2harness maintainers

## Context

Harnesses authored against `deepclause-pi` may call `pi_bash`, and some SOP
procedures genuinely need shell steps (file manipulation, CLI tools, data
preparation). The first export design rejected all shell access. That is safe
but makes a class of SOPs unexportable, and it forces authors to rewrite
procedures around a read-only tool set.

`deepclause-agentvm` (npm `deepclause-agentvm`, CLI `agentvm`) runs an Alpine
Linux VM from a WASM image inside a Node worker thread. It supports command
execution, host directory mounts, networking with a firewall, port forwarding,
persistent root overlays, and snapshots.

## Decision

Exported harnesses may run bash inside an **AgentVM** sandbox. The sandbox is an
opt-in runtime component of the export:

- The harness declares shell use in `harness.json` (`runtime.tools` contains
  `bash`/`pi_bash`, or `runtime.sandbox.enabled` is true).
- `s2h export` bundles `deepclause-agentvm` and its WASM image only when the
  sandbox is used; a `--sandbox none` export stays lean and rejects shell.
- The exported runtime registers a `bash` tool (and a `pi_bash` compatibility
  alias) whose implementation is one long-lived `AgentVM` per session, started
  lazily.
- Default posture: **network disabled**, harness mounted read-only at
  `/mnt/harness`, a scratch `/workspace` mounted from an operator-supplied host
  directory, no host secrets, wall-clock timeout, and output byte caps.
- When the harness declares an allowlisted egress need, network is enabled and
  enforced with AgentVM `setFirewall` rules (first match wins) limited to those
  hosts/ports. `networkRateLimit` is set from configuration.
- `persistentRoot` is off by default; when enabled, it lives under the
  operator-configured `S2H_SANDBOX_DIR`, never inside `harness/`.

## Consequences

- SOPs that need shell steps become exportable without exposing the host shell.
- The export image grows substantially when the sandbox is included (the WASM
  image is hundreds of MB). This is why it is opt-in per harness.
- AgentVM is explicitly experimental and uses `node:wasi`, which "is known to
  have some quirks and possibly security flaws". Therefore the sandbox is
  **defense in depth, not a trust boundary**: mount only non-secret data,
  disable network by default, cap resources, and run the API process itself with
  least privilege.
- The `pi_bash` compatibility adapter no longer has to parse and allowlist argv
  for correctness; the sandbox is the execution environment. The adapter still
  normalizes shell vs argv form so harnesses are portable.
- Tests must cover VM lifecycle, mount confinement, firewall enforcement,
  timeout/output caps, and command-injection attempts.

## Alternatives considered

1. **Reject all shell (status quo).** Safe and simple, but not useful for a real
   subset of SOPs.
2. **Run host bash with an argv allowlist.** Smaller image, but the allowlist is
   brittle and a single miss is a host compromise.
3. **Require an external container/VM per executor.** Strong isolation, but adds
   orchestration and a dependency the export cannot assume.
4. **Only run shell during `s2h run` (local), never in exports.** Keeps exports
   read-only but makes exported harnesses incomplete.

## Follow-ups

- Define the exact firewall manifest (`harness.json.runtime.sandbox.allow`) and
  its schema.
- Decide whether the sandbox is one VM per session or a small pool.
- Evaluate `deepclause-agentvm`'s `persistentRoot` for stateful SOPs and how its
  upper image is backed up with the export.
