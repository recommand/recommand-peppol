import { describe, expect, it, mock } from "bun:test";

// The key rules are the SML's, not ours; a key we accept but the SML refuses only
// fails later, at the moment the company is registered. The module reaches the
// database on import, which this test has no use for.
mock.module("@recommand/db", () => ({ db: {} }));
const { MIGRATION_KEY_PATTERN, normalizeMigrationKey } = await import("../data/participant-migrations");

describe("migration key rules", () => {
  it("accepts keys the SML accepts", () => {
    for (const key of ["Ab12$#xyZ9!kLm", "AB12ab()", "Zz09_-Zz09_-Zz09_-Zz09_-", "Pp11++Qq"]) {
      expect(MIGRATION_KEY_PATTERN.test(key)).toBe(true);
    }
  });

  it("refuses keys that miss a character class, are too short or too long, or contain whitespace", () => {
    const refused = [
      "ab12$#xyz9!klm", // no upper case
      "AB12$#XYZ9!KLM", // no lower case
      "Abcd$#xyZw!kLm", // no digits
      "Ab12xyZ9kLm", // no specials
      "Ab1$xyZ", // too short
      "Ab12$#xyZ9!kLmAb12$#xyZ9!", // too long
      "Ab12$# xyZ9!kLm", // whitespace
    ];
    for (const key of refused) {
      expect(MIGRATION_KEY_PATTERN.test(key)).toBe(false);
    }
  });

  it("trims a pasted key and rejects an invalid one with the rules", () => {
    expect(normalizeMigrationKey("  Ab12$#xyZ9!kLm\n")).toBe("Ab12$#xyZ9!kLm");
    expect(() => normalizeMigrationKey("nope")).toThrow("8 to 24 characters");
  });
});
