import { describe, it, expect } from "bun:test";
import {
  parseCbeAddress,
  hasCompleteCbeAddress,
  pickFirstEstablishmentAddress,
} from "../data/cbe-public-search/parse-address";

describe("parseCbeAddress", () => {
  it("parses root enterprise address", () => {
    const addr = {
      Street: { Description: { Value: "Rue de la Loi" } },
      HouseNumber: "16",
      Zipcode: "1000",
      Municipality: { Description: { Value: "Brussels" } },
    };

    const result = parseCbeAddress(addr);

    expect(result).toEqual({
      street: "Rue de la Loi",
      number: "16",
      postalCode: "1000",
      city: "Brussels",
      country: "BE",
    });
    expect(hasCompleteCbeAddress(result)).toBe(true);
  });

  it("treats incomplete addresses as incomplete", () => {
    const addr = {
      Street: { Description: { Value: "" } },
      HouseNumber: "",
      Zipcode: "",
      Municipality: { Description: { Value: "" } },
    };

    const result = parseCbeAddress(addr);

    expect(hasCompleteCbeAddress(result)).toBe(false);
  });
});

describe("pickFirstEstablishmentAddress", () => {
  it("falls back to first establishment with complete address", () => {
    const establishments = [
      {
        Address: {
          Street: { Description: { Value: "" } },
          HouseNumber: "",
          Zipcode: "",
          Municipality: { Description: { Value: "" } },
        },
      },
      {
        Address: {
          Street: { Description: { Value: "Avenue Louise" } },
          HouseNumber: "54",
          Zipcode: "1050",
          Municipality: { Description: { Value: "Ixelles" } },
        },
      },
    ];

    const result = pickFirstEstablishmentAddress(establishments);

    expect(result).toEqual({
      street: "Avenue Louise",
      number: "54",
      postalCode: "1050",
      city: "Ixelles",
      country: "BE",
    });
  });
});
