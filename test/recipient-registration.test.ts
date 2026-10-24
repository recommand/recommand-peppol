/**
 * Telling a participant the network does not know from one that could not be looked up.
 *
 * Only the SML's answer that neither record exists makes a participant unregistered, so
 * that a send skips a transmission that cannot be delivered. Any other failure leaves the
 * participant possibly registered, and the transmission is attempted as before.
 */

import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";

// Nothing under test touches the database, but the playground lookups connect at
// import time.
mock.module("@recommand/db", () => ({ db: {} }));

const recipient = await import("../data/recipient");
const { getRecipientCapabilities, lookUpRecipient } = await import("../data/recipient-capabilities");

const dnsError = (code: string) => Object.assign(new Error(`query ${code}`), { code });

function resolver(answers: { naptr: unknown; cname: unknown }) {
  const answer = (value: unknown) => async () => {
    if (value instanceof Error) throw value;
    return value as any;
  };
  return { resolveNaptr: answer(answers.naptr), resolveCname: answer(answers.cname) };
}

const PARTICIPANT = { recipientAddress: "9930:de999999999", useTestNetwork: false };

describe("isParticipantUnregistered", () => {
  it("is true when DNS says neither the NAPTR nor the CNAME record exists", async () => {
    const answers = { naptr: dnsError("ENOTFOUND"), cname: dnsError("ENODATA") };
    expect(await recipient.isParticipantUnregistered(PARTICIPANT, resolver(answers))).toBe(true);
  });

  it("is false when the NAPTR record exists", async () => {
    const answers = {
      naptr: [{ flags: "U", service: "Meta:SMP", regexp: "!.*!https://smp.example!", replacement: "", order: 100, preference: 10 }],
      cname: dnsError("ENOTFOUND"),
    };
    expect(await recipient.isParticipantUnregistered(PARTICIPANT, resolver(answers))).toBe(false);
  });

  it("is false when only the older CNAME record exists", async () => {
    const answers = { naptr: dnsError("ENOTFOUND"), cname: ["smp.example"] };
    expect(await recipient.isParticipantUnregistered(PARTICIPANT, resolver(answers))).toBe(false);
  });

  it("is false when DNS gives no answer", async () => {
    for (const code of ["ETIMEOUT", "ESERVFAIL", "ECONNREFUSED"]) {
      const answers = { naptr: dnsError(code), cname: dnsError("ENOTFOUND") };
      expect(await recipient.isParticipantUnregistered(PARTICIPANT, resolver(answers)), code).toBe(false);
    }
    const unexpected = { naptr: new Error("no code at all"), cname: dnsError("ENOTFOUND") };
    expect(await recipient.isParticipantUnregistered(PARTICIPANT, resolver(unexpected))).toBe(false);
  });
});

describe("lookUpRecipient", () => {
  const spies: { mockRestore(): void }[] = [];
  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  // Each test looks up an address of its own: what is found is cached.
  const lookUp = (recipientAddress: string, options?: { checkRegistration?: boolean }) =>
    lookUpRecipient({ recipientAddress, isPlayground: false, useTestNetwork: false, teamId: "team_1" }, options);

  function smpLookupFails(unregistered: boolean) {
    spies.push(spyOn(console, "log").mockImplementation(() => {}));
    spies.push(spyOn(recipient, "verifyRecipient").mockRejectedValue(new Error("Failed to verify recipient: Unable to connect")));
    const check = spyOn(recipient, "isParticipantUnregistered").mockResolvedValue(unregistered);
    spies.push(check);
    return check;
  }

  it("reports a participant the network does not know as not registered", async () => {
    smpLookupFails(true);
    expect(await lookUp("9930:de000000001")).toEqual({ status: "not_registered" });
  });

  it("reports any other failed lookup as unavailable", async () => {
    smpLookupFails(false);
    expect(await lookUp("9930:de000000002")).toEqual({ status: "unavailable" });
  });

  it("does not ask the network when only the capabilities are wanted", async () => {
    const check = smpLookupFails(true);
    expect(await lookUp("9930:de000000003", { checkRegistration: false })).toEqual({ status: "unavailable" });
    expect(await getRecipientCapabilities({ recipientAddress: "9930:de000000004", isPlayground: false, useTestNetwork: false, teamId: "team_1" })).toBeNull();
    expect(check).not.toHaveBeenCalled();
  });

  it("does not ask the network about a participant it found", async () => {
    spies.push(spyOn(recipient, "verifyRecipient").mockResolvedValue({
      smpUrl: "https://smp.example/iso6523-actorid-upis::9930:de000000005",
      serviceMetadataReferences: [],
      smpHostnames: ["smp.example"],
      supportedDocuments: [],
    }));
    const check = spyOn(recipient, "isParticipantUnregistered").mockResolvedValue(true);
    spies.push(check);

    const lookup = await lookUp("9930:de000000005");
    expect(lookup.status).toBe("found");
    expect(check).not.toHaveBeenCalled();
  });
});
