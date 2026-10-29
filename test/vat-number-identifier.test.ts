/**
 * A VAT number as a Peppol participant identifier, the one rule company registration and
 * the email-only buyer address share. Registration keeps to the default VAT schemes; an
 * address written into a document may fall back to the code list's.
 */

import { describe, expect, it } from "bun:test";
import { vatNumberIdentifier } from "../utils/identifiers/vat-number";

describe("vatNumberIdentifier", () => {
  it("puts a VAT number under its country's default VAT scheme, cleaned", () => {
    expect(vatNumberIdentifier("DE", "DE 811.569.869")).toEqual({ scheme: "9930", identifier: "DE811569869" });
    expect(vatNumberIdentifier("BE", "be0123456749")).toEqual({ scheme: "9925", identifier: "BE0123456749" });
  });

  it("takes the country from the number's prefix rather than the one given", () => {
    expect(vatNumberIdentifier("DE", "ATU13585627")).toEqual({ scheme: "9914", identifier: "ATU13585627" });
  });

  it("knows the prefixes a country writes besides its code", () => {
    expect(vatNumberIdentifier("GB", "XI123456782")).toEqual({ scheme: "9932", identifier: "XI123456782" });
  });

  it("gives a number written without a prefix the prefix of the given country", () => {
    expect(vatNumberIdentifier("DE", "811569869")).toEqual({ scheme: "9930", identifier: "DE811569869" });
    expect(vatNumberIdentifier("AT", "U13585627")).toEqual({ scheme: "9914", identifier: "ATU13585627" });
  });

  it("is null for a country without a default VAT scheme, Greece's EL included", () => {
    expect(vatNumberIdentifier("DK", "DK13585628")).toBeNull();
    expect(vatNumberIdentifier("GR", "EL094259216")).toBeNull();
    expect(vatNumberIdentifier("GR", "094259216")).toBeNull();
  });

  it("falls back to the code list's VAT scheme when asked to", () => {
    expect(vatNumberIdentifier("GR", "EL094259216", { schemes: "codeList" })).toEqual({ scheme: "9933", identifier: "EL094259216" });
    expect(vatNumberIdentifier("GR", "094259216", { schemes: "codeList" })).toEqual({ scheme: "9933", identifier: "EL094259216" });
    expect(vatNumberIdentifier("FR", "FR40303265045", { schemes: "codeList" })).toEqual({ scheme: "9957", identifier: "FR40303265045" });
    // Not in our country list, but in the code list.
    expect(vatNumberIdentifier(null, "MK4030003475089", { schemes: "codeList" })).toEqual({ scheme: "9942", identifier: "MK4030003475089" });
    // A default scheme still comes first, and a country the code list lacks has none.
    expect(vatNumberIdentifier("DE", "DE811569869", { schemes: "codeList" })).toEqual({ scheme: "9930", identifier: "DE811569869" });
    expect(vatNumberIdentifier("DK", "DK13585628", { schemes: "codeList" })).toBeNull();
  });

  it("keeps to the default schemes otherwise, as company registration does", () => {
    expect(vatNumberIdentifier("FR", "FR40303265045")).toBeNull();
    expect(vatNumberIdentifier(null, "MK4030003475089")).toBeNull();
  });

  it("is null when the number names no country, or there is no number", () => {
    expect(vatNumberIdentifier("DE", "QQ123456789")).toBeNull();
    expect(vatNumberIdentifier(null, "811569869")).toBeNull();
    expect(vatNumberIdentifier("DE", "")).toBeNull();
    expect(vatNumberIdentifier("DE", null)).toBeNull();
  });
});
