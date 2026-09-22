// Minimal semver validation sufficient for harness versions.
// Kept dependency-free on purpose; `s2h` only needs to accept or reject a
// version string, not to compare ranges.

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function isValidSemver(value: unknown): value is string {
  return typeof value === "string" && SEMVER_RE.test(value);
}
