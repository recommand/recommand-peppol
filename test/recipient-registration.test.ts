/**
 * Telling a participant the network does not know from one that could not be looked up.
 *
 * Only the SML's answer that the participant's NAPTR record does not exist makes it
 * unregistered, so that a send skips a transmission that cannot be delivered. Any other
 * failure leaves the participant possibly registered, and the transmission is attempted
 * as before.
 */

import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { getSmpUrl, isParticipantUnregistered, lookUpSmpUrl, SmlLookupError } from "../data/recipient";
import * as naptr from "../utils/naptr";
import { resolveNaptr } from "../utils/naptr";

const dnsError = (code: string) => Object.assign(new Error(`query ${code}`), { code });

const SMP_RECORD = { flags: "U", service: "Meta:SMP", regexp: "!.*!https://smp.example!", replacement: "", order: 100, preference: 10 };

function resolver(naptrAnswer: unknown) {
  return {
    resolveNaptr: mock(async () => {
      if (naptrAnswer instanceof Error) throw naptrAnswer;
      return naptrAnswer as any;
    }),
  };
}

const PARTICIPANT = { recipientAddress: "9930:de999999999", useTestNetwork: false };

describe("resolveNaptr", () => {
  it("finds the SMP a record points to", async () => {
    expect(await resolveNaptr("example", resolver([SMP_RECORD]))).toEqual({ status: "found", smpUrl: "https://smp.example" });
  });

  it("is absent when DNS says the name or record does not exist", async () => {
    for (const code of ["ENOTFOUND", "ENODATA"]) {
      expect(await resolveNaptr("example", resolver(dnsError(code))), code).toEqual({ status: "absent" });
    }
  });

  it("is unknown when DNS gives no answer, or a record names no usable SMP", async () => {
    for (const code of ["ETIMEOUT", "ESERVFAIL", "ECONNREFUSED"]) {
      expect(await resolveNaptr("example", resolver(dnsError(code))), code).toEqual({ status: "unknown" });
    }
    const unusable = { ...SMP_RECORD, regexp: "", replacement: "" };
    expect(await resolveNaptr("example", resolver([unusable]))).toEqual({ status: "unknown" });
  });
});

describe("isParticipantUnregistered", () => {
  it("is true when DNS says the NAPTR record does not exist", async () => {
    for (const code of ["ENOTFOUND", "ENODATA"]) {
      expect(await isParticipantUnregistered(PARTICIPANT, resolver(dnsError(code))), code).toBe(true);
    }
  });

  it("is false when the NAPTR record exists", async () => {
    expect(await isParticipantUnregistered(PARTICIPANT, resolver([SMP_RECORD]))).toBe(false);
  });

  it("is false when DNS gives no answer for the NAPTR record", async () => {
    for (const code of ["ETIMEOUT", "ESERVFAIL", "ECONNREFUSED"]) {
      expect(await isParticipantUnregistered(PARTICIPANT, resolver(dnsError(code))), code).toBe(false);
    }
  });
});

describe("lookUpSmpUrl", () => {
  it("points to the participant on the SMP its NAPTR record names", async () => {
    expect(await lookUpSmpUrl(PARTICIPANT, resolver([SMP_RECORD]))).toEqual({
      status: "found",
      smpUrl: "https://smp.example/iso6523-actorid-upis::9930%3Ade999999999",
    });
  });

  it("is absent when DNS says the NAPTR record does not exist", async () => {
    expect(await lookUpSmpUrl(PARTICIPANT, resolver(dnsError("ENOTFOUND")))).toEqual({ status: "absent" });
  });

  it("gives no answer, rather than guessing a host, when DNS gives none for the NAPTR record", async () => {
    for (const naptrAnswer of [dnsError("ETIMEOUT"), dnsError("ESERVFAIL"), [{ ...SMP_RECORD, regexp: "", replacement: "" }]]) {
      expect(await lookUpSmpUrl(PARTICIPANT, resolver(naptrAnswer))).toEqual({ status: "unknown" });
    }
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
    const error = await getSmpUrl(PARTICIPANT).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SmlLookupError);
    expect((error as Error).message).toContain("is not registered in the SML");
  });
});
