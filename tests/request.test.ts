import { describe, expect, it } from "vitest";
import { buildAuthoringRequest } from "../src/authoring/request.js";

describe("buildAuthoringRequest", () => {
  it("includes the request, SOP files, and non-update instruction", () => {
    const text = buildAuthoringRequest({
      request: "Turn this into a harness",
      sopFiles: ["sops/refund-desk/README.md"],
      name: "refund-desk",
      update: false,
    });
    expect(text).toContain("Turn this into a harness");
    expect(text).toContain("sops/refund-desk/README.md");
    expect(text).toContain("Create new skills only");
    expect(text).toContain("s2h-authoring");
  });

  it("uses update instructions when updating", () => {
    const text = buildAuthoringRequest({ sopFiles: [], update: true });
    expect(text).toContain("Update this s2h harness");
    expect(text).toContain("regenerate generated skills");
  });
});
