import { describe, expect, it } from "bun:test";
import { Errors } from "postmark";
import { isUnreachableEmailAddressError } from "@peppol/data/email/unreachable-address";

describe("isUnreachableEmailAddressError", () => {
  it("recognises an address Postmark marked as inactive", () => {
    const error = Errors.ApiInputError.buildSpecificError(
      "You tried to send to recipient(s) that have been marked as inactive. Found inactive addresses: john@example.com.",
      406,
      422,
    );
    expect(isUnreachableEmailAddressError(error)).toBe(true);
  });

  it("recognises an invalid 'To' address", () => {
    const error = Errors.ApiInputError.buildSpecificError(
      "Error parsing 'To': Illegal email address 'john@'. It must contain the '@' symbol.",
      300,
      422,
    );
    expect(isUnreachableEmailAddressError(error)).toBe(true);
  });

  it("does not hide other failures", () => {
    expect(
      isUnreachableEmailAddressError(
        Errors.ApiInputError.buildSpecificError("Invalid 'From' address.", 300, 422),
      ),
    ).toBe(false);
    expect(isUnreachableEmailAddressError(new Errors.InternalServerError("Boom", 500, 500))).toBe(false);
    expect(isUnreachableEmailAddressError(new Error("Failed to send email"))).toBe(false);
  });
});
