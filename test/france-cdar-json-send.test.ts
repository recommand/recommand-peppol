import { describe, expect, it } from "bun:test";
import {
  FRANCE_CDAR_DOCUMENT_TYPE_INFO,
  FRANCE_CDAR_NON_REGULATED_PROCESS_ID,
  getFranceCdarProcessId,
} from "../utils/document-types";
import { franceCdarToXML } from "../utils/parsing/france-cdar/to-xml";
import { parseFranceCdarFromXML } from "../utils/parsing/france-cdar/from-xml";
import {
  franceCdarReasonCodeSchema,
  franceCdarSchema,
  sendFranceCdarSchema,
} from "../utils/parsing/france-cdar/schemas";
import { detectDoctypeId } from "../utils/parsing/parse-document";
import { sendDocumentSchema } from "../utils/parsing/send-document";
import { parsePeppolAddress } from "../utils/parsing/peppol-address";

const request = {
  recipient: "0225:987654321_STATUTS",
  documentType: "frenchInvoicingCdar",
  document: {
    businessProcess: "REGULATED",
    senderRole: "BY",
    issuerLegalId: "123456789",
    recipientRole: "SE",
    statusCode: "205",
    invoiceId: "INV-2026-001",
    invoiceIssueDate: "2026-07-23",
    sellerLegalId: "123456789",
  },
} as const;

describe("France CDAR JSON sending", () => {
  it("accepts CDAR in the send-document request and defaults the phase", () => {
    const parsed = sendDocumentSchema.parse(request);

    expect(parsed.documentType).toBe("frenchInvoicingCdar");
    expect(parsed.document).toMatchObject({
      phase: "23",
      statusCode: "205",
      invoiceId: "INV-2026-001",
    });
    expect(parsed.document).not.toHaveProperty("recipientElectronicAddress");
  });

  it("generates CDAR XML that round-trips to the normalized JSON", () => {
    const parsed = sendDocumentSchema.parse(request);
    const sendDocument = sendFranceCdarSchema.parse(parsed.document);
    const document = franceCdarSchema.parse({
      ...sendDocument,
      id: "CDAR-2026-001",
      issueDate: "2026-07-23",
      recipientElectronicAddress: parsePeppolAddress(request.recipient).identifier,
    });

    const reparsed = parseFranceCdarFromXML(
      franceCdarToXML({ franceCdar: document })
    );

    expect(reparsed).toEqual(document);
  });

  it("distinguishes the French invoicing profile from generic CDAR XML", () => {
    const document = franceCdarSchema.parse({
      ...request.document,
      id: "CDAR-2026-001",
      issueDate: "2026-07-23",
      phase: "23",
      recipientElectronicAddress: parsePeppolAddress(request.recipient).identifier,
    });
    const frenchXml = franceCdarToXML({ franceCdar: document });
    const genericXml = frenchXml.replace(
      "urn.cpro.gouv.fr:1p0:CDV:invoice",
      "urn:example:generic:cdar"
    );

    expect(detectDoctypeId(frenchXml)).toBe(
      FRANCE_CDAR_DOCUMENT_TYPE_INFO.docTypeId
    );
    expect(detectDoctypeId(genericXml)).toBeNull();
  });

  it("selects the Peppol process from the business-process classification", () => {
    expect(getFranceCdarProcessId("REGULATED")).toBe(
      FRANCE_CDAR_DOCUMENT_TYPE_INFO.processId
    );
    expect(getFranceCdarProcessId("NON_REGULATED")).toBe(
      FRANCE_CDAR_NON_REGULATED_PROCESS_ID
    );
    expect(getFranceCdarProcessId("B2C")).toBe(
      FRANCE_CDAR_NON_REGULATED_PROCESS_ID
    );
  });

  it("only accepts documented AFNOR reason codes", () => {
    expect(franceCdarReasonCodeSchema.safeParse("DOUBLON").success).toBe(true);
    expect(franceCdarReasonCodeSchema.safeParse("UNKNOWN_REASON").success).toBe(
      false
    );
  });

  it("requires an explanation for the AUTRE reason code", () => {
    const withoutExplanation = sendFranceCdarSchema.safeParse({
      ...request.document,
      statusCode: "207",
      reasonCode: "AUTRE",
    });
    const withExplanation = sendFranceCdarSchema.safeParse({
      ...request.document,
      statusCode: "207",
      reasonCode: "AUTRE",
      reason: "The invoice needs manual review.",
    });

    expect(withoutExplanation.success).toBe(false);
    expect(withExplanation.success).toBe(true);
  });
});
