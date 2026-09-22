import { describe, expect, it } from "vitest";
import { bumpVersion, isValidSemver } from "../src/harness/semver.js";

describe("isValidSemver", () => {
  it("accepts plain and pre-release semver", () => {
    expect(isValidSemver("0.0.0")).toBe(true);
    expect(isValidSemver("0.1.0")).toBe(true);
    expect(isValidSemver("1.2.3")).toBe(true);
    expect(isValidSemver("10.20.30")).toBe(true);
    expect(isValidSemver("1.2.3-alpha.1")).toBe(true);
    expect(isValidSemver("1.2.3+build.5")).toBe(true);
  });

  it("rejects malformed versions", () => {
    expect(isValidSemver("1")).toBe(false);
    expect(isValidSemver("1.2")).toBe(false);
    expect(isValidSemver("01.2.3")).toBe(false);
    expect(isValidSemver("1.2.3-")).toBe(false);
    expect(isValidSemver("v1.2.3")).toBe(false);
    expect(isValidSemver("")).toBe(false);
    expect(isValidSemver(1.2)).toBe(false);
  });
});

describe("bumpVersion", () => {
  it("bumps patch, minor, and major", () => {
    expect(bumpVersion("0.0.0", "patch")).toBe("0.0.1");
    expect(bumpVersion("0.1.0", "minor")).toBe("0.2.0");
    expect(bumpVersion("0.1.0", "major")).toBe("1.0.0");
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });

  it("drops pre-release and build metadata", () => {
    expect(bumpVersion("1.2.3-alpha.1", "patch")).toBe("1.2.3");
    expect(bumpVersion("1.2.3+build.5", "patch")).toBe("1.2.4");
  });
});
