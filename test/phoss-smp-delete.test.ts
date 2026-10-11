import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import { deleteServiceGroup } from "../data/phoss-smp/service-group";
import { deleteServiceMetadata } from "../data/phoss-smp/service-metadata";

// Unregistering asks the SMP to delete what the company published. When the SMP no
// longer has it, the outcome the delete asks for is already there, so the company
// can still be unregistered; the caller is told it was missing. Other failures stay
// failures.

const fetchMock = spyOn(globalThis, "fetch");

function respondWith(status: number, body: string) {
  fetchMock.mockImplementation(
    Object.assign(async () => new Response(body, { status }), { preconnect: globalThis.fetch.preconnect }),
  );
}

const ref = { peppolIdentifierEas: "0208", peppolIdentifierAddress: "0123456749", useTestNetwork: false };
const notRegistered =
  "Not found: Service Group 'iso6523-actorid-upis::0208:0123456749' is not registered on this SMP at https://smp.net.recommand.com/iso6523-actorid-upis::0208:0123456749";

afterEach(() => {
  fetchMock.mockReset();
});

afterAll(() => {
  fetchMock.mockRestore();
});

describe("deleting a service group", () => {
  it("reports a service group the SMP does not have as missing", async () => {
    respondWith(404, notRegistered);
    expect(await deleteServiceGroup(ref)).toBe("missing");
  });

  it("reports a service group it deleted as deleted", async () => {
    respondWith(200, "");
    expect(await deleteServiceGroup(ref)).toBe("deleted");
  });

  it("still fails on any other error", async () => {
    respondWith(500, "Internal error");
    await expect(deleteServiceGroup(ref)).rejects.toThrow("Failed to delete service group in SMP");
  });
});

describe("deleting service metadata", () => {
  const metadata = { ...ref, documentTypeCode: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1" };

  it("treats metadata the SMP does not have as deleted", async () => {
    respondWith(404, notRegistered);
    expect(await deleteServiceMetadata(metadata)).toBe(true);
  });

  it("still fails on any other error", async () => {
    respondWith(500, "Internal error");
    await expect(deleteServiceMetadata(metadata)).rejects.toThrow("Failed to delete service metadata in SMP");
  });
});
