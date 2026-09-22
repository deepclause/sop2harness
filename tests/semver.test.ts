import { describe, expect, it } from "vitest";
import { isValidSemver } from "../src/harness/semver.js";

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
