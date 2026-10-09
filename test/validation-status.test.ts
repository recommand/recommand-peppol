import { describe, expect, it } from "bun:test";
import { fallbackT } from "@core/lib/translations";
import { getValidationStatus } from "../lib/client/validation-status";

describe("validation status", () => {
  it("flags only an invalid document as having errors", () => {
    expect(getValidationStatus(fallbackT, { result: "invalid", errors: [] })).toMatchObject({
      kind: "invalid",
      label: "Invalid",
    });
  });

  it("shows a document no rule set exists for as not validated, not as an error", () => {
    const status = getValidationStatus(fallbackT, { result: "not_supported", errors: [] });
    expect(status).toMatchObject({ kind: "notValidated", label: "Not validated" });
    expect(status!.description).not.toContain("error");
  });

  it("tells an unreachable validation service apart from both", () => {
    const status = getValidationStatus(fallbackT, { result: "error", errors: [] });
    expect(status).toMatchObject({ kind: "unavailable", label: "Validation unavailable" });
    expect(status!.description).toContain("does not mean the document is wrong");
  });

  it("shows nothing for a valid or unvalidated document", () => {
    expect(getValidationStatus(fallbackT, { result: "valid", errors: [] })).toBeNull();
    expect(getValidationStatus(fallbackT, null)).toBeNull();
    expect(getValidationStatus(fallbackT, undefined)).toBeNull();
  });
});
