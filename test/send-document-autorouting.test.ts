/**
 * Autorouting a JSON send.
 *
 * A send that leaves the document type identifier or the process open is written as the
 * first combination, in our order of preference, the recipient is registered to receive.
 * What the caller does state stands, and a recipient that cannot be looked up leaves the
 * document as the format it was always written as.
 */

import { describe, expect, it } from "bun:test";
import type { RecipientCapabilities } from "../data/recipient-capabilities";
import { SendingFailure } from "../utils/pipelines/sending/errors";
import { selectFormatAndProcess } from "../utils/pipelines/sending/select-format";
import { invoiceDocumentType } from "../utils/type-repository/document-types/invoice";

const BIS3_DOC_TYPE_ID =
  "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1";
const FRANCE_CIUS_DOC_TYPE_ID =
  "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0::2.1";
const NLCIUS_DOC_TYPE_ID =
  "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:nen.nl:nlcius:v1.0::2.1";
const CII_DOC_TYPE_ID =
  "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100::CrossIndustryInvoice##urn:cen.eu:en16931:2017::D22B";

const BILLING_PROCESS_ID = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
const FRANCE_REGULATED_PROCESS_ID = "urn:peppol:france:billing:regulated";
const FRANCE_NON_REGULATED_PROCESS_ID = "urn:peppol:france:billing:non-regulated";

const belgianCompany = {
  country: "BE",
  accessPointProvider: "recommand-ap1" as const,
};
const frenchCompany = {
  country: "FR",
  accessPointProvider: "at-shared-ap-fr" as const,
};

const plainInvoice = {};
const frenchInvoice = (businessProcess: "REGULATED" | "NON_REGULATED") => ({
  countrySpecific: { country: "FR", businessProcess },
});

function registeredFor(
  registrations: Record<string, string[]>
): RecipientCapabilities {
  return {
    supportsDocType: (docTypeId) => docTypeId in registrations,
    getProcessIds: async (docTypeId) => registrations[docTypeId] ?? [],
  };
}

function select(options: {
  document?: unknown;
  doctypeId?: string;
  processId?: string;
  company?: { country: string; accessPointProvider: "recommand-ap1" | "at-shared-ap-fr" };
  capabilities?: RecipientCapabilities | null;
}) {
  return selectFormatAndProcess({
    documentType: invoiceDocumentType,
    document: options.document ?? plainInvoice,
    recipientAddress: "0208:987654321",
    doctypeId: options.doctypeId,
    processId: options.processId,
    company: options.company ?? belgianCompany,
    isPlayground: false,
    capabilities: options.capabilities ?? null,
  });
}

describe("send document autorouting", () => {
  it("keeps to the default format when the recipient could not be looked up", async () => {
    const selection = await select({ capabilities: null });

    expect(selection.format.key).toBe("peppol-ubl-bis3-invoice");
    expect(selection.processId).toBe(BILLING_PROCESS_ID);
    expect(selection.peppolRoutingFailure).toBeUndefined();
  });

  it("picks the first format the recipient is registered for", async () => {
    const selection = await select({
      capabilities: registeredFor({
        [NLCIUS_DOC_TYPE_ID]: [BILLING_PROCESS_ID],
        [CII_DOC_TYPE_ID]: [BILLING_PROCESS_ID],
      }),
    });

    expect(selection.format.key).toBe("si-ubl-invoice");
    expect(selection.processId).toBe(BILLING_PROCESS_ID);
  });

  it("prefers the format we rank highest over the others the recipient receives", async () => {
    const selection = await select({
      capabilities: registeredFor({
        [CII_DOC_TYPE_ID]: [BILLING_PROCESS_ID],
        [BIS3_DOC_TYPE_ID]: [BILLING_PROCESS_ID],
        [NLCIUS_DOC_TYPE_ID]: [BILLING_PROCESS_ID],
      }),
    });

    expect(selection.format.key).toBe("peppol-ubl-bis3-invoice");
  });

  it("skips a registered document type whose processes do not match", async () => {
    const selection = await select({
      capabilities: registeredFor({
        [BIS3_DOC_TYPE_ID]: ["urn:fdc:peppol.eu:poacc:bis:invoice_response:3"],
        [CII_DOC_TYPE_ID]: [BILLING_PROCESS_ID],
      }),
    });

    expect(selection.format.key).toBe("cii-d22b-en16931");
  });

  it("routes a French document over the French process the recipient registered", async () => {
    const selection = await select({
      document: frenchInvoice("REGULATED"),
      company: frenchCompany,
      capabilities: registeredFor({
        [FRANCE_CIUS_DOC_TYPE_ID]: [FRANCE_REGULATED_PROCESS_ID],
      }),
    });

    expect(selection.format.key).toBe("ubl-france-cius-invoice");
    expect(selection.processId).toBe(FRANCE_REGULATED_PROCESS_ID);
  });

  it("never routes a document over the French process it does not belong to", async () => {
    const selection = await select({
      document: frenchInvoice("NON_REGULATED"),
      company: frenchCompany,
      capabilities: registeredFor({
        [FRANCE_CIUS_DOC_TYPE_ID]: [FRANCE_REGULATED_PROCESS_ID],
      }),
    });

    expect(selection.peppolRoutingFailure).toBeDefined();
  });

  it("does not route a company that is not set up for the French flows into them", async () => {
    const selection = await select({
      company: belgianCompany,
      capabilities: registeredFor({
        [BIS3_DOC_TYPE_ID]: [FRANCE_REGULATED_PROCESS_ID],
        [FRANCE_CIUS_DOC_TYPE_ID]: [FRANCE_REGULATED_PROCESS_ID],
      }),
    });

    expect(selection.peppolRoutingFailure).toBeDefined();
    expect(selection.format.key).toBe("peppol-ubl-bis3-invoice");
    expect(selection.processId).toBe(BILLING_PROCESS_ID);
  });

  it("reports a recipient that receives nothing we can send, and still prepares the document", async () => {
    const selection = await select({
      capabilities: registeredFor({}),
    });

    expect(selection.peppolRoutingFailure).toContain("0208:987654321");
    expect(selection.format.key).toBe("peppol-ubl-bis3-invoice");
    expect(selection.processId).toBe(BILLING_PROCESS_ID);
  });

  it("takes a caller that states both at its word, without a lookup", async () => {
    const selection = await select({
      doctypeId: CII_DOC_TYPE_ID,
      processId: BILLING_PROCESS_ID,
      capabilities: registeredFor({}),
    });

    expect(selection.format.key).toBe("cii-d22b-en16931");
    expect(selection.processId).toBe(BILLING_PROCESS_ID);
    expect(selection.peppolRoutingFailure).toBeUndefined();
  });

  it("routes the process within the document type identifier the caller states", async () => {
    const selection = await select({
      document: frenchInvoice("NON_REGULATED"),
      company: frenchCompany,
      doctypeId: FRANCE_CIUS_DOC_TYPE_ID,
      capabilities: registeredFor({
        [BIS3_DOC_TYPE_ID]: [BILLING_PROCESS_ID],
        [FRANCE_CIUS_DOC_TYPE_ID]: [FRANCE_NON_REGULATED_PROCESS_ID],
      }),
    });

    expect(selection.format.key).toBe("ubl-france-cius-invoice");
    expect(selection.processId).toBe(FRANCE_NON_REGULATED_PROCESS_ID);
  });

  it("routes the document type identifier within the process the caller states", async () => {
    const selection = await select({
      processId: BILLING_PROCESS_ID,
      capabilities: registeredFor({
        [FRANCE_CIUS_DOC_TYPE_ID]: [FRANCE_REGULATED_PROCESS_ID],
        [NLCIUS_DOC_TYPE_ID]: [BILLING_PROCESS_ID],
      }),
    });

    expect(selection.format.key).toBe("si-ubl-invoice");
    expect(selection.processId).toBe(BILLING_PROCESS_ID);
  });

  it("refuses a document type identifier that does not belong to the document type", async () => {
    expect(
      select({ doctypeId: "urn:not:a:doctype", processId: BILLING_PROCESS_ID })
    ).rejects.toThrow(SendingFailure);
  });

  it("refuses a process identifier no format of the document type supports", async () => {
    expect(select({ processId: "urn:not:a:process" })).rejects.toThrow(
      SendingFailure
    );
  });
});
