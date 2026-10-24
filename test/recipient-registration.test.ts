/**
 * Telling a participant the network does not know from one that could not be looked up.
 *
 * Only the SML's answer that neither record exists makes a participant unregistered, so
 * that a send skips a transmission that cannot be delivered. Any other failure leaves the
 * participant possibly registered, and the transmission is attempted as before.
 */

import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { getSmpUrl, isParticipantUnregistered, lookUpSmpUrl, SmlLookupError } from "../data/recipient";
import * as naptr from "../utils/naptr";
import { lookUpCname, resolveNaptr } from "../utils/naptr";

const dnsError = (code: string) => Object.assign(new Error(`query ${code}`), { code });

const SMP_RECORD = { flags: "U", service: "Meta:SMP", regexp: "!.*!https://smp.example!", replacement: "", order: 100, preference: 10 };

function resolver(answers: { naptr: unknown; cname: unknown }) {
  const answer = (value: unknown) =>
    mock(async () => {
      if (value instanceof Error) throw value;
      return value as any;
    });
  return { resolveNaptr: answer(answers.naptr), resolveCname: answer(answers.cname) };
}

const PARTICIPANT = { recipientAddress: "9930:de999999999", useTestNetwork: false };

describe("resolveNaptr", () => {
  it("finds the SMP a record points to", async () => {
    const answers = resolver({ naptr: [SMP_RECORD], cname: [] });
    expect(await resolveNaptr("example", answers)).toEqual({ status: "found", smpUrl: "https://smp.example" });
  });

  it("is absent when DNS says the name or record does not exist", async () => {
    for (const code of ["ENOTFOUND", "ENODATA"]) {
      expect(await resolveNaptr("example", resolver({ naptr: dnsError(code), cname: [] })), code).toEqual({ status: "absent" });
    }
  });

  it("is unknown when DNS gives no answer, or a record names no usable SMP", async () => {
    for (const code of ["ETIMEOUT", "ESERVFAIL", "ECONNREFUSED"]) {
      expect(await resolveNaptr("example", resolver({ naptr: dnsError(code), cname: [] })), code).toEqual({ status: "unknown" });
    }
    const unusable = { ...SMP_RECORD, regexp: "", replacement: "" };
    expect(await resolveNaptr("example", resolver({ naptr: [unusable], cname: [] }))).toEqual({ status: "unknown" });
  });
});

describe("lookUpCname", () => {
  it("tells a record, its absence and no answer apart", async () => {
    expect(await lookUpCname("example", resolver({ naptr: [], cname: ["smp.example"] }))).toEqual({ status: "found" });
    expect(await lookUpCname("example", resolver({ naptr: [], cname: dnsError("ENOTFOUND") }))).toEqual({ status: "absent" });
    expect(await lookUpCname("example", resolver({ naptr: [], cname: dnsError("ETIMEOUT") }))).toEqual({ status: "unknown" });
  });
});

describe("isParticipantUnregistered", () => {
  it("is true when DNS says neither the NAPTR nor the CNAME record exists", async () => {
    const answers = resolver({ naptr: dnsError("ENOTFOUND"), cname: dnsError("ENODATA") });
    expect(await isParticipantUnregistered(PARTICIPANT, answers)).toBe(true);
  });

  it("is false, without asking about the CNAME, when the NAPTR record exists", async () => {
    const answers = resolver({ naptr: [SMP_RECORD], cname: dnsError("ENOTFOUND") });
    expect(await isParticipantUnregistered(PARTICIPANT, answers)).toBe(false);
    expect(answers.resolveCname).not.toHaveBeenCalled();
  });

  it("is false, without asking about the CNAME, when DNS gives no answer for the NAPTR record", async () => {
    for (const code of ["ETIMEOUT", "ESERVFAIL", "ECONNREFUSED"]) {
      const answers = resolver({ naptr: dnsError(code), cname: dnsError("ENOTFOUND") });
      expect(await isParticipantUnregistered(PARTICIPANT, answers), code).toBe(false);
      expect(answers.resolveCname).not.toHaveBeenCalled();
    }
  });

  it("is false when only the older CNAME record exists, or DNS gives no answer for it", async () => {
    expect(await isParticipantUnregistered(PARTICIPANT, resolver({ naptr: dnsError("ENOTFOUND"), cname: ["smp.example"] }))).toBe(false);
    expect(await isParticipantUnregistered(PARTICIPANT, resolver({ naptr: dnsError("ENOTFOUND"), cname: dnsError("ETIMEOUT") }))).toBe(false);
  });
});

describe("lookUpSmpUrl", () => {
  const PARTICIPANT_PATH = "/iso6523-actorid-upis::9930%3Ade999999999";

  it("points to the participant on the SMP its NAPTR record names", async () => {
    const answers = resolver({ naptr: [SMP_RECORD], cname: dnsError("ENOTFOUND") });
    expect(await lookUpSmpUrl(PARTICIPANT, answers)).toEqual({ status: "found", smpUrl: `https://smp.example${PARTICIPANT_PATH}` });
    expect(answers.resolveCname).not.toHaveBeenCalled();
  });

  it("gives no answer, rather than guessing the CNAME host, when DNS gives none for the NAPTR record", async () => {
    for (const naptrAnswer of [dnsError("ETIMEOUT"), dnsError("ESERVFAIL"), [{ ...SMP_RECORD, regexp: "", replacement: "" }]]) {
      const answers = resolver({ naptr: naptrAnswer, cname: ["smp.example"] });
      expect(await lookUpSmpUrl(PARTICIPANT, answers)).toEqual({ status: "unknown" });
      expect(answers.resolveCname).not.toHaveBeenCalled();
    }
  });

  it("falls back to the CNAME host only when the NAPTR record is absent and the CNAME record exists", async () => {
    const found = await lookUpSmpUrl(PARTICIPANT, resolver({ naptr: dnsError("ENOTFOUND"), cname: ["smp.example"] }));
    expect(found.status).toBe("found");
    const smpUrl = found.status === "found" ? found.smpUrl : "";
    expect(smpUrl).toStartWith("http://B-");
    expect(smpUrl).toEndWith(`.iso6523-actorid-upis.participant.sml.prod.tech.peppol.org${PARTICIPANT_PATH}`);
    expect(await lookUpSmpUrl(PARTICIPANT, resolver({ naptr: dnsError("ENOTFOUND"), cname: dnsError("ENODATA") }))).toEqual({ status: "absent" });
    expect(await lookUpSmpUrl(PARTICIPANT, resolver({ naptr: dnsError("ENOTFOUND"), cname: dnsError("ETIMEOUT") }))).toEqual({ status: "unknown" });
  });
});

describe("getSmpUrl", () => {
  const spies: { mockRestore(): void }[] = [];
  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  it("throws SmlLookupError when the SML gives no answer", async () => {
    spies.push(spyOn(naptr, "resolveNaptr").mockResolvedValue({ status: "unknown" }));
    await expect(getSmpUrl(PARTICIPANT)).rejects.toBeInstanceOf(SmlLookupError);
  });

  it("throws a plain error when the SML has no entry for the participant", async () => {
    spies.push(spyOn(naptr, "resolveNaptr").mockResolvedValue({ status: "absent" }));
    spies.push(spyOn(naptr, "lookUpCname").mockResolvedValue({ status: "absent" }));
    const error = await getSmpUrl(PARTICIPANT).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SmlLookupError);
    expect((error as Error).message).toContain("is not registered in the SML");
  });
});
