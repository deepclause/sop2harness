// Minimal semver validation sufficient for harness versions.
// Kept dependency-free on purpose; `s2h` only needs to accept or reject a
// version string, not to compare ranges.

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function isValidSemver(value: unknown): value is string {
  return typeof value === "string" && SEMVER_RE.test(value);
}

export type VersionBump = "major" | "minor" | "patch";

/**
 * Increment a validated semver version. Pre-release and build metadata are
 * dropped, matching `npm version` bump semantics.
 */
export function bumpVersion(version: string, bump: VersionBump): string {
  const match = SEMVER_RE.exec(version);
  if (!match) throw new Error(`Invalid semver: ${version}`);

  // Releasing a pre-release with a patch bump returns the base version
  // (semver/npm semantics), e.g. 1.2.3-alpha.1 -> 1.2.3.
  if (match[4] && bump === "patch") {
    return `${match[1]}.${match[2]}.${match[3]}`;
  }

  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);
  if (bump === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bump === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}
