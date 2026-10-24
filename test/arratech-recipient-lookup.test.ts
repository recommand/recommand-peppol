import { afterAll, afterEach, describe, expect, it, mock, spyOn } from "bun:test";

// Arratech accepts a transaction without checking the receiver, so the SMP lookup is
// done before handing it over. Only an SML that answers the participant is not there
// makes the send fail as recipient_not_found; an SML that gives no answer is a
// transport failure, because the recipient may well be registered.

mock.module("@recommand/db", () => ({ db: {} }));
const naptr = await import("../utils/naptr");
const naptrSpy = spyOn(naptr, "resolveNaptr");
const cnameSpy = spyOn(naptr, "lookUpCname").mockResolvedValue({ status: "absent" });
const fetchMock = spyOn(globalThis, "fetch");

const { sendAs4 } = await import("../data/at/ap");

for (const name of ["ARRATECH_TEST_API_KEY", "ARRATECH_TEST_ORG_ID", "ARRATECH_TEST_SMP_REF", "ARRATECH_TEST_AP_REF"]) {
  process.env[name] ??= "test";
}

const send = () =>
  sendAs4({
    senderId: "0208:0123456749",
    receiverId: "0208:0987654321",
    docTypeId: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1",
    processId: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
    countryC1: "BE",
    body: "<Invoice/>",
    useTestNetwork: true,
  });

afterEach(() => {
  naptrSpy.mockReset();
  cnameSpy.mockClear();
  fetchMock.mockReset();
});

afterAll(() => {
  naptrSpy.mockRestore();
  cnameSpy.mockRestore();
  fetchMock.mockRestore();
});

describe("sending through Arratech to a recipient the SML cannot place", () => {
  it("fails as recipient_not_found when the SML has no entry for the recipient", async () => {
    naptrSpy.mockResolvedValue({ status: "absent" });
    const sent = await send();
    expect(sent.ok).toBe(false);
    expect(sent.sendingException?.category).toBe("recipient_not_found");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails as a transport error, without guessing a host, when the SML gives no answer", async () => {
    naptrSpy.mockResolvedValue({ status: "unknown" });
    const sent = await send();
    expect(sent.ok).toBe(false);
    expect(sent.sendingException?.category).toBe("transport");
    expect(sent.sendingException?.message).toContain("the SML gave no usable answer");
    expect(cnameSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
