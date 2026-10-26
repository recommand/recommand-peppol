import { describe, expect, it } from "bun:test";
import { namesMatch } from "@peppol/utils/names-match";

describe("matching a representative's name", () => {
  it("ignores case, accents and extra middle names", () => {
    expect(namesMatch("Inger Lise Strøm", "inger strøm")).toBe(true);
    expect(namesMatch("Jean-Pierre Dupont", "jean pierre DUPONT")).toBe(true);
    expect(namesMatch("Zoë Lefèvre", "Zoe Lefevre")).toBe(true);
  });

  it("matches Norwegian letters written without them", () => {
    expect(namesMatch("Bjørn Søreide", "Bjorn Soreide")).toBe(true);
    expect(namesMatch("Bjørn Søreide", "Bjoern Soereide")).toBe(true);
    expect(namesMatch("Åse Ødegård", "Ase Odegard")).toBe(true);
    expect(namesMatch("Åse Ødegård", "Aase Oedegaard")).toBe(true);
    expect(namesMatch("Kjæråsen", "Kjaerasen")).toBe(true);
  });

  it("still tells different people apart", () => {
    expect(namesMatch("Bjørn Søreide", "Bjarne Søreide")).toBe(false);
    expect(namesMatch("Ola Hansen", "Ola Hanssen")).toBe(false);
    expect(namesMatch("", "Ola Hansen")).toBe(false);
  });
});
