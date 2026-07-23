import { describe, expect, it } from "bun:test";
import {
  FRANCE_CDAR_DOCUMENT_TYPE_INFO,
  FRANCE_CDAR_NON_REGULATED_PROCESS_ID,
  getFranceCdarProcessId,
} from "../utils/document-types";
import { franceCdarToXML } from "../utils/parsing/france-cdar/to-xml";
import { parseFranceCdarFromXML } from "../utils/parsing/france-cdar/from-xml";
import {
  franceCdarBusinessProcessSchema,
  franceCdarCollectedAmountSchema,
  franceCdarReasonCodeSchema,
  franceCdarRoleCodeSchema,
  franceCdarSchema,
  franceCdarStatusCodeSchema,
  getFranceCdarPhaseForStatus,
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
    senderRole: "WK",
    issuerRole: "BY",
    issuerLegalId: "123456789",
    issuerLegalIdScheme: "0002",
    recipientRole: "SE",
    statusCode: "205",
    statusDate: "2026-07-23T14:05:09",
    invoiceId: "INV-2026-001",
    invoiceTypeCode: "380",
    invoiceIssueDate: "2026-07-23",
    sellerLegalId: "123456789",
    sellerLegalIdScheme: "0002",
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
    expect(parsed.document).not.toHaveProperty(
      "recipientElectronicAddressScheme"
    );
  });

  it("defaults transmission statuses to phase 305", () => {
    const parsed = sendDocumentSchema.parse({
      ...request,
      document: {
        ...request.document,
        senderRole: "WK",
        issuerRole: "WK",
        issuerLegalId: undefined,
        issuerLegalIdScheme: undefined,
        statusCode: "200",
      },
    });

    expect(parsed.document).toMatchObject({
      phase: "305",
      statusCode: "200",
    });
  });

  it("maps every status to its documented phase", () => {
    for (const statusCode of ["200", "201", "202", "203", "213", "501"] as const) {
      expect(getFranceCdarPhaseForStatus(statusCode)).toBe("305");
    }

    for (const statusCode of [
      "204",
      "205",
      "206",
      "207",
      "208",
      "209",
      "210",
      "211",
      "212",
      "214",
    ] as const) {
      expect(getFranceCdarPhaseForStatus(statusCode)).toBe("23");
    }
  });

  it("does not cross-check sender and issuer roles against the phase", () => {
    const processingIssuer = sendFranceCdarSchema.safeParse({
      ...request.document,
      issuerRole: "WK",
    });
    const transmissionSender = sendFranceCdarSchema.safeParse({
      ...request.document,
      senderRole: "BY",
      issuerRole: "WK",
      issuerLegalId: undefined,
      issuerLegalIdScheme: undefined,
      statusCode: "200",
    });
    const transmissionIssuer = sendFranceCdarSchema.safeParse({
      ...request.document,
      senderRole: "WK",
      issuerRole: "BY",
      issuerLegalId: undefined,
      issuerLegalIdScheme: undefined,
      statusCode: "200",
    });

    expect(processingIssuer.success).toBe(true);
    expect(transmissionSender.success).toBe(true);
    expect(transmissionIssuer.success).toBe(true);
  });

  it("uses the French Annex business-process and party-role vocabularies", () => {
    expect(franceCdarBusinessProcessSchema.safeParse("B2CINT").success).toBe(
      true
    );
    expect(franceCdarRoleCodeSchema.safeParse("DFH").success).toBe(true);
  });

  it("exempts a DFH recipient from the phase-305 and address rules", () => {
    const base = {
      ...request.document,
      id: "CDAR-2026-DFH",
      issueDate: "2026-07-23T14:05:09",
      phase: "305",
      statusCode: "200",
      recipientRole: "DFH",
    } as const;

    // BR-FR-CDV-07: issuerLegalId is allowed at phase 305 when addressed to DFH.
    expect(franceCdarSchema.safeParse(base).success).toBe(true);
    // BR-FR-CDV-08: a DFH recipient needs no electronic address.
    expect(base).not.toHaveProperty("recipientElectronicAddress");

    // A non-DFH, non-WK recipient still must omit issuerLegalId at phase 305...
    expect(
      franceCdarSchema.safeParse({ ...base, recipientRole: "SE" }).success
    ).toBe(false);
    // ...and still requires an electronic address.
    expect(
      franceCdarSchema.safeParse({
        ...base,
        recipientRole: "SE",
        issuerLegalId: undefined,
        issuerLegalIdScheme: undefined,
      }).success
    ).toBe(false);
  });

  it("requires an electronic address and scheme for every non-WK recipient", () => {
    const document = {
      ...request.document,
      id: "CDAR-2026-ADDRESS",
      issueDate: "2026-07-23T14:05:09",
      phase: "23",
    } as const;

    expect(franceCdarSchema.safeParse(document).success).toBe(false);
    expect(
      franceCdarSchema.safeParse({
        ...document,
        recipientElectronicAddress: "987654321_STATUTS",
      }).success
    ).toBe(false);
    expect(
      franceCdarSchema.safeParse({
        ...document,
        recipientElectronicAddressScheme: "0225",
      }).success
    ).toBe(false);
    expect(
      franceCdarSchema.safeParse({
        ...document,
        recipientElectronicAddress: "987654321_STATUTS",
        recipientElectronicAddressScheme: "0225",
      }).success
    ).toBe(true);
  });

  it("exempts only WK recipients from the electronic-address requirement", () => {
    expect(
      franceCdarSchema.safeParse({
        ...request.document,
        id: "CDAR-2026-WK",
        issueDate: "2026-07-23T14:05:09",
        phase: "23",
        recipientRole: "WK",
      }).success
    ).toBe(true);
  });

  it("generates CDAR XML that round-trips to the normalized JSON", () => {
    const parsed = sendDocumentSchema.parse(request);
    const sendDocument = sendFranceCdarSchema.parse(parsed.document);
    const document = franceCdarSchema.parse({
      ...sendDocument,
      id: "CDAR-2026-001",
      issueDate: "2026-07-23T14:05:09",
      recipientElectronicAddress: parsePeppolAddress(request.recipient).identifier,
      recipientElectronicAddressScheme:
        parsePeppolAddress(request.recipient).schemeId,
    });

    const xml = franceCdarToXML({ franceCdar: document });
    const reparsed = parseFranceCdarFromXML(xml);

    expect(xml).toContain('<udt:DateTimeString format="204">20260723140509');
    expect(xml).toContain('<qdt:DateTimeString format="204">20260723000000');
    expect(xml).toMatch(
      /<ram:SenderTradeParty>\s*<ram:RoleCode>WK<\/ram:RoleCode>/
    );
    expect(xml).toMatch(
      /<ram:IssuerTradeParty>\s*<ram:GlobalID schemeID="0002">123456789<\/ram:GlobalID>\s*<ram:RoleCode>BY<\/ram:RoleCode>/
    );
    expect(reparsed).toEqual(document);
  });

  it("preserves each legal-ID and electronic-address scheme", () => {
    const document = franceCdarSchema.parse({
      ...request.document,
      id: "CDAR-2026-SCHEMES",
      issueDate: "2026-07-23T14:05:09",
      phase: "23",
      issuerLegalId: "12345678901234",
      issuerLegalIdScheme: "0009",
      recipientLegalId: "EU1234567890123456",
      recipientLegalIdScheme: "0223",
      recipientElectronicAddress: "FR12345678901",
      recipientElectronicAddressScheme: "9957",
      sellerLegalId: "NON-EU123456789012",
      sellerLegalIdScheme: "0227",
    });

    const xml = franceCdarToXML({ franceCdar: document });

    expect(xml).toContain(
      '<ram:GlobalID schemeID="0009">12345678901234</ram:GlobalID>'
    );
    expect(xml).toContain(
      '<ram:GlobalID schemeID="0223">EU1234567890123456</ram:GlobalID>'
    );
    expect(xml).toContain(
      '<ram:URIID schemeID="9957">FR12345678901</ram:URIID>'
    );
    expect(xml).toContain(
      '<ram:GlobalID schemeID="0227">NON-EU123456789012</ram:GlobalID>'
    );
    expect(parseFranceCdarFromXML(xml)).toEqual(document);
  });

  it("requires identifier values and schemes to be supplied together", () => {
    for (const document of [
      { ...request.document, issuerLegalIdScheme: undefined },
      { ...request.document, sellerLegalIdScheme: undefined },
      {
        ...request.document,
        recipientLegalIdScheme: "0009" as const,
      },
    ]) {
      expect(sendFranceCdarSchema.safeParse(document).success).toBe(false);
    }

    expect(
      franceCdarSchema.safeParse({
        ...request.document,
        id: "CDAR-2026-PAIR",
        issueDate: "2026-07-23T14:05:09",
        phase: "23",
        recipientElectronicAddress: "987654321_STATUTS",
      }).success
    ).toBe(false);
  });

  it("enforces nonblank and maximum-length document strings", () => {
    const completeDocument = {
      ...request.document,
      id: "C".repeat(50),
      issueDate: "2026-07-23T14:05:09",
      phase: "23",
      invoiceId: "I".repeat(100),
      recipientElectronicAddress: "A".repeat(100),
      recipientElectronicAddressScheme: "0225",
      reason: "R".repeat(250),
      reasonNote: "N".repeat(2000),
    } as const;

    expect(franceCdarSchema.safeParse(completeDocument).success).toBe(true);

    for (const document of [
      { ...completeDocument, id: " " },
      { ...completeDocument, id: "C".repeat(51) },
      { ...completeDocument, invoiceId: "\t" },
      { ...completeDocument, invoiceId: "I".repeat(101) },
      { ...completeDocument, recipientElectronicAddress: "\n" },
      {
        ...completeDocument,
        recipientElectronicAddress: "A".repeat(101),
      },
      { ...completeDocument, reason: " " },
      { ...completeDocument, reason: "R".repeat(251) },
      { ...completeDocument, reasonNote: " " },
      { ...completeDocument, reasonNote: "N".repeat(2001) },
    ]) {
      expect(franceCdarSchema.safeParse(document).success).toBe(false);
    }

    expect(
      sendFranceCdarSchema.safeParse({
        ...request.document,
        id: " ",
      }).success
    ).toBe(false);
  });

  it("accepts any four-digit legal-ID scheme without scheme-specific lengths", () => {
    expect(
      sendFranceCdarSchema.safeParse({
        ...request.document,
        issuerLegalId: "1",
        issuerLegalIdScheme: "0208",
      }).success
    ).toBe(true);
    expect(
      sendFranceCdarSchema.safeParse({
        ...request.document,
        issuerLegalId: "1".repeat(100),
        issuerLegalIdScheme: "9999",
      }).success
    ).toBe(true);
    expect(
      sendFranceCdarSchema.safeParse({
        ...request.document,
        issuerLegalId: "1".repeat(101),
        issuerLegalIdScheme: "9999",
      }).success
    ).toBe(false);

    for (const field of [
      "issuerLegalId",
      "recipientLegalId",
      "sellerLegalId",
    ] as const) {
      expect(
        sendFranceCdarSchema.safeParse({
          ...request.document,
          [field]: " ",
          [`${field}Scheme`]: "0002",
        }).success
      ).toBe(false);
    }
  });

  it("requires a syntactically valid four-digit EAS scheme", () => {
    const document = {
      ...request.document,
      id: "CDAR-2026-EAS",
      issueDate: "2026-07-23T14:05:09",
      phase: "23",
      recipientElectronicAddress: "987654321_STATUTS",
    } as const;

    for (const scheme of ["225", "02255", "ABCD", "02 5", ""]) {
      expect(
        franceCdarSchema.safeParse({
          ...document,
          recipientElectronicAddressScheme: scheme,
        }).success
      ).toBe(false);
    }

    expect(
      franceCdarSchema.safeParse({
        ...document,
        recipientElectronicAddressScheme: "0225",
      }).success
    ).toBe(true);
  });

  it("works around Arratech combining the SBDH address in CDAR URIID", () => {
    const document = franceCdarSchema.parse({
      ...request.document,
      id: "CDAR-2026-ARRATECH",
      issueDate: "2026-07-23T14:05:09",
      phase: "23",
      recipientElectronicAddress: "987654321_STATUTS",
      recipientElectronicAddressScheme: "0225",
    });
    const arratechXml = franceCdarToXML({ franceCdar: document }).replace(
      '<ram:URIID schemeID="0225">987654321_STATUTS</ram:URIID>',
      "<ram:URIID>0225:987654321_STATUTS</ram:URIID>"
    );

    expect(parseFranceCdarFromXML(arratechXml)).toEqual(document);
  });

  it("emits the mandatory acknowledgement elements", () => {
    const document = franceCdarSchema.parse({
      ...request.document,
      id: "CDAR-2026-MANDATORY",
      issueDate: "2026-07-23T14:05:09",
      statusDate: "2026-07-22T09:30:00",
      phase: "23",
      recipientElectronicAddress: parsePeppolAddress(request.recipient).identifier,
      recipientElectronicAddressScheme:
        parsePeppolAddress(request.recipient).schemeId,
    });

    const xml = franceCdarToXML({ franceCdar: document });

    // MDG-30/MDT-74, MDT-77 and MDG-31/MDT-78, in CDAR sequence order.
    expect(xml).toMatch(
      /<rsm:AcknowledgementDocument>\s*<ram:MultipleReferencesIndicator>\s*<udt:Indicator>false<\/udt:Indicator>\s*<\/ram:MultipleReferencesIndicator>\s*<ram:TypeCode>23<\/ram:TypeCode>\s*<ram:IssueDateTime>\s*<udt:DateTimeString format="204">20260722093000<\/udt:DateTimeString>\s*<\/ram:IssueDateTime>/
    );
    // MDT-91, between MDT-87 and MDG-35.
    expect(xml).toMatch(
      /<ram:IssuerAssignedID>INV-2026-001<\/ram:IssuerAssignedID>\s*<ram:TypeCode>380<\/ram:TypeCode>\s*<ram:FormattedIssueDateTime>/
    );
    // The status date is independent of the CDAR creation date.
    expect(xml).toContain(
      '<udt:DateTimeString format="204">20260723140509</udt:DateTimeString>'
    );
    expect(parseFranceCdarFromXML(xml)).toEqual(document);
  });

  it("treats the invoice type code as optional but codelist-constrained", () => {
    // MDT-91 carries no obligation rule; BR-FR-04 only constrains its value.
    expect(
      sendFranceCdarSchema.safeParse({
        ...request.document,
        invoiceTypeCode: undefined,
      }).success
    ).toBe(true);

    expect(
      sendFranceCdarSchema.safeParse({
        ...request.document,
        invoiceTypeCode: "999",
      }).success
    ).toBe(false);
  });

  it("treats the status date as optional when sending", () => {
    const parsed = sendFranceCdarSchema.safeParse({
      ...request.document,
      statusDate: undefined,
    });

    expect(parsed.success).toBe(true);
  });

  it("falls back to the CDAR creation date when MDT-78 is absent", () => {
    const document = franceCdarSchema.parse({
      ...request.document,
      id: "CDAR-2026-NO-MDT78",
      issueDate: "2026-07-23T14:05:09",
      statusDate: "2026-07-22T09:30:00",
      phase: "23",
      recipientElectronicAddress: parsePeppolAddress(request.recipient).identifier,
      recipientElectronicAddressScheme:
        parsePeppolAddress(request.recipient).schemeId,
    });
    const withoutStatusDate = franceCdarToXML({ franceCdar: document }).replace(
      /<ram:IssueDateTime>\s*<udt:DateTimeString format="204">20260722093000<\/udt:DateTimeString>\s*<\/ram:IssueDateTime>/,
      ""
    );

    expect(parseFranceCdarFromXML(withoutStatusDate)).toEqual({
      ...document,
      statusDate: "2026-07-23T14:05:09",
    });
  });

  it("accepts an incoming CDAR that omits the invoice type code", () => {
    // MDT-91 is 0..1 in a received CDAR; only sending requires it.
    const incoming = `<rsm:CrossDomainAcknowledgementAndResponse xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossDomainAcknowledgementAndResponse:100"><rsm:ExchangedDocumentContext><ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>REGULATED</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn.cpro.gouv.fr:1p0:CDV:invoice</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext><rsm:ExchangedDocument><ram:ID>253ae4e3-6857-4652-8d30-5f02bb4a247d</ram:ID><ram:Name>Cycle de vie</ram:Name><ram:IssueDateTime><udt:DateTimeString format="102">20260723</udt:DateTimeString></ram:IssueDateTime><ram:SenderTradeParty><ram:GlobalID schemeID="0225">133512194</ram:GlobalID><ram:RoleCode>BY</ram:RoleCode></ram:SenderTradeParty><ram:IssuerTradeParty><ram:GlobalID schemeID="0225">133512194</ram:GlobalID><ram:RoleCode>BY</ram:RoleCode></ram:IssuerTradeParty><ram:RecipientTradeParty><ram:GlobalID schemeID="0225">133512194</ram:GlobalID><ram:RoleCode>SE</ram:RoleCode><ram:URIUniversalCommunication><ram:URIID>0225:133512194</ram:URIID></ram:URIUniversalCommunication></ram:RecipientTradeParty></rsm:ExchangedDocument><rsm:AcknowledgementDocument><ram:TypeCode>23</ram:TypeCode><ram:ReferenceReferencedDocument><ram:IssuerAssignedID>INV-TEST-UBL-FR</ram:IssuerAssignedID><ram:FormattedIssueDateTime><qdt:DateTimeString format="102">20260716</qdt:DateTimeString></ram:FormattedIssueDateTime><ram:ProcessConditionCode>202</ram:ProcessConditionCode><ram:ProcessCondition>Reçue</ram:ProcessCondition><ram:IssuerTradeParty><ram:GlobalID schemeID="0225">133512194</ram:GlobalID><ram:RoleCode>SE</ram:RoleCode></ram:IssuerTradeParty></ram:ReferenceReferencedDocument></rsm:AcknowledgementDocument></rsm:CrossDomainAcknowledgementAndResponse>`;

    expect(parseFranceCdarFromXML(incoming)).toEqual({
      id: "253ae4e3-6857-4652-8d30-5f02bb4a247d",
      issueDate: "2026-07-23",
      businessProcess: "REGULATED",
      phase: "23",
      senderRole: "BY",
      issuerRole: "BY",
      issuerLegalId: "133512194",
      issuerLegalIdScheme: "0225",
      recipientRole: "SE",
      recipientLegalId: "133512194",
      recipientLegalIdScheme: "0225",
      recipientElectronicAddress: "133512194",
      recipientElectronicAddressScheme: "0225",
      statusCode: "202",
      statusDate: "2026-07-23",
      invoiceId: "INV-TEST-UBL-FR",
      invoiceIssueDate: "2026-07-16",
      sellerLegalId: "133512194",
      sellerLegalIdScheme: "0225",
    });
  });

  it("parses CDAR dates in UN/CEFACT formats 102 and 204", () => {
    const document = franceCdarSchema.parse({
      ...request.document,
      id: "CDAR-2026-001",
      issueDate: "2026-07-23T14:05:09",
      phase: "23",
      recipientElectronicAddress: parsePeppolAddress(request.recipient).identifier,
      recipientElectronicAddressScheme:
        parsePeppolAddress(request.recipient).schemeId,
    });
    const format204Xml = franceCdarToXML({ franceCdar: document });
    const format102Xml = format204Xml
      .replaceAll('format="204"', 'format="102"')
      .replaceAll("20260723140509", "20260723")
      .replaceAll("20260723000000", "20260723");
    const unsupportedFormatXml = format204Xml.replace(
      'format="204"',
      'format="203"'
    );

    expect(parseFranceCdarFromXML(format204Xml)).toEqual(document);
    expect(parseFranceCdarFromXML(format102Xml)).toEqual({
      ...document,
      issueDate: "2026-07-23",
      statusDate: "2026-07-23",
    });
    expect(() => parseFranceCdarFromXML(unsupportedFormatXml)).toThrow(
      "IssueDateTime DateTimeString format must be 102 or 204"
    );
  });

  it("distinguishes the French invoicing profile from generic CDAR XML", () => {
    const document = franceCdarSchema.parse({
      ...request.document,
      id: "CDAR-2026-001",
      issueDate: "2026-07-23T14:05:09",
      phase: "23",
      recipientElectronicAddress: parsePeppolAddress(request.recipient).identifier,
      recipientElectronicAddressScheme:
        parsePeppolAddress(request.recipient).schemeId,
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
    expect(getFranceCdarProcessId("B2CINT")).toBe(
      FRANCE_CDAR_NON_REGULATED_PROCESS_ID
    );
  });

  it("validates the individual status-code and reason-code vocabularies", () => {
    expect(franceCdarStatusCodeSchema.safeParse("207").success).toBe(true);
    expect(franceCdarStatusCodeSchema.safeParse("999").success).toBe(false);
    expect(franceCdarReasonCodeSchema.safeParse("DOUBLON").success).toBe(true);
    expect(franceCdarReasonCodeSchema.safeParse("UNKNOWN_REASON").success).toBe(
      false
    );
  });

  it("does not validate reason-code compatibility with the status code", () => {
    expect(
      sendFranceCdarSchema.safeParse({
        ...request.document,
        statusCode: "207",
        reasonCode: "JUSTIF_ABS",
      }).success
    ).toBe(true);
    expect(
      sendFranceCdarSchema.safeParse({
        ...request.document,
        statusCode: "205",
        reasonCode: "DOUBLON",
      }).success
    ).toBe(true);
    expect(
      sendFranceCdarSchema.safeParse({
        ...request.document,
        statusCode: "207",
        reasonCode: "UNKNOWN_REASON",
      }).success
    ).toBe(false);
  });

  it("requires a reason code for status 501 (BR-FR-CDV-15)", () => {
    const status501 = {
      ...request.document,
      statusCode: "501",
      senderRole: "WK",
      issuerRole: "WK",
      issuerLegalId: undefined,
      issuerLegalIdScheme: undefined,
      invoiceIssueDate: undefined,
      sellerLegalId: undefined,
      sellerLegalIdScheme: undefined,
    } as const;

    expect(sendFranceCdarSchema.safeParse(status501).success).toBe(false);
    expect(
      sendFranceCdarSchema.safeParse({
        ...status501,
        reasonCode: "REJ_SEMAN",
      }).success
    ).toBe(true);

    const document = franceCdarSchema.parse({
      ...status501,
      id: "CDAR-2026-501",
      issueDate: "2026-07-23T14:05:09",
      phase: "305",
      reasonCode: "REJ_SEMAN",
      reason: "The submitted file could not be accepted.",
      recipientElectronicAddress:
        parsePeppolAddress(request.recipient).identifier,
      recipientElectronicAddressScheme:
        parsePeppolAddress(request.recipient).schemeId,
    });
    const xml = franceCdarToXML({ franceCdar: document });
    const parsed = parseFranceCdarFromXML(xml);

    expect(xml).toContain("<ram:ReasonCode>REJ_SEMAN</ram:ReasonCode>");
    expect(parsed).toMatchObject({
      statusCode: "501",
      reasonCode: "REJ_SEMAN",
      reason: "The submitted file could not be accepted.",
    });
  });

  it("requires an explanation for the AUTRE reason code", () => {
    const withoutExplanation = sendFranceCdarSchema.safeParse({
      ...request.document,
      statusCode: "207",
      reasonCode: "AUTRE",
    });
    const withMdt114ReasonOnly = sendFranceCdarSchema.safeParse({
      ...request.document,
      statusCode: "207",
      reasonCode: "AUTRE",
      reason: "This MDT-114 reason is not an IncludedNote.",
    });
    const withExplanation = sendFranceCdarSchema.safeParse({
      ...request.document,
      statusCode: "207",
      reasonCode: "AUTRE",
      reasonNote: "The invoice needs manual review.",
    });

    expect(withoutExplanation.success).toBe(false);
    expect(withMdt114ReasonOnly.success).toBe(false);
    expect(withExplanation.success).toBe(true);
  });

  it("serializes and parses an AUTRE explanation as an IncludedNote", () => {
    const document = franceCdarSchema.parse({
      ...request.document,
      id: "CDAR-2026-AUTRE",
      issueDate: "2026-07-23T14:05:09",
      phase: "23",
      statusCode: "207",
      reasonCode: "AUTRE",
      reason: "Optional MDT-114 reason.",
      reasonNote: "The invoice needs manual review.",
      recipientElectronicAddress:
        parsePeppolAddress(request.recipient).identifier,
      recipientElectronicAddressScheme:
        parsePeppolAddress(request.recipient).schemeId,
      collectedAmounts: [
        { amount: "100.00", currency: "EUR", vatPercent: "20.00" },
      ],
    });

    const xml = franceCdarToXML({ franceCdar: document });

    expect(xml).toMatch(
      /<ram:ReasonCode>AUTRE<\/ram:ReasonCode>\s*<ram:Reason>Optional MDT-114 reason\.<\/ram:Reason>\s*<ram:SequenceNumeric>1<\/ram:SequenceNumeric>\s*<ram:IncludedNote>\s*<ram:Content>The invoice needs manual review\.<\/ram:Content>\s*<\/ram:IncludedNote>\s*<ram:SpecifiedDocumentCharacteristic>/
    );
    expect(parseFranceCdarFromXML(xml)).toEqual(document);
  });

  it("uses date-time JSON for sending and accepts incoming date-only values", () => {
    expect(
      sendFranceCdarSchema.safeParse({
        ...request.document,
        issueDate: "2026-07-23T14:05:09",
      }).success
    ).toBe(true);
    expect(
      sendFranceCdarSchema.safeParse({
        ...request.document,
        issueDate: "2026-07-23",
      }).success
    ).toBe(false);
    expect(
      franceCdarSchema.safeParse({
        ...request.document,
        id: "CDAR-2026-FORMAT-102",
        issueDate: "2026-07-23",
        phase: "23",
        recipientElectronicAddress:
          parsePeppolAddress(request.recipient).identifier,
        recipientElectronicAddressScheme:
          parsePeppolAddress(request.recipient).schemeId,
      }).success
    ).toBe(true);
    expect(
      sendFranceCdarSchema.safeParse({
        ...request.document,
        invoiceIssueDate: "2026-07-23T09:30:00",
      }).success
    ).toBe(false);
  });

  it("serializes and parses complete MEN collected amounts for status 212", () => {
    const document = franceCdarSchema.parse({
      ...request.document,
      id: "CDAR-2026-212",
      issueDate: "2026-07-23T14:05:09",
      phase: "23",
      statusCode: "212",
      recipientElectronicAddress: parsePeppolAddress(request.recipient).identifier,
      recipientElectronicAddressScheme:
        parsePeppolAddress(request.recipient).schemeId,
      collectedAmounts: [
        { amount: "100.00", currency: "EUR", vatPercent: "20.00" },
        { amount: "-25.123456", currency: "EUR", vatPercent: "5.5" },
      ],
    });

    const xml = franceCdarToXML({ franceCdar: document });

    expect(xml).toContain("<ram:TypeCode>MEN</ram:TypeCode>");
    expect(xml).toContain(
      '<ram:ValueAmount currencyID="EUR">100.00</ram:ValueAmount>'
    );
    expect(xml).toContain("<ram:ValuePercent>20.00</ram:ValuePercent>");
    expect(parseFranceCdarFromXML(xml)).toEqual(document);
  });

  it("projects reason and MEN values from only the first status-detail block", () => {
    const document = franceCdarSchema.parse({
      ...request.document,
      id: "CDAR-2026-STATUS-DETAIL",
      issueDate: "2026-07-23T14:05:09",
      phase: "23",
      statusCode: "207",
      reasonCode: "DOUBLON",
      reasonNote: "First status-detail note.",
      recipientElectronicAddress: parsePeppolAddress(request.recipient).identifier,
      recipientElectronicAddressScheme:
        parsePeppolAddress(request.recipient).schemeId,
      collectedAmounts: [
        { amount: "100.00", currency: "EUR", vatPercent: "20.00" },
      ],
    });
    const secondStatusDetail = [
      "<ram:SpecifiedDocumentStatus>",
      "<ram:ReasonCode>AUTRE</ram:ReasonCode>",
      "<ram:Reason>Must not leak from the second block.</ram:Reason>",
      "<ram:IncludedNote><ram:Content>Must not leak from the second block.</ram:Content></ram:IncludedNote>",
      "<ram:SpecifiedDocumentCharacteristic>",
      "<ram:TypeCode>MEN</ram:TypeCode>",
      '<ram:ValueAmount currencyID="EUR">200.00</ram:ValueAmount>',
      "<ram:ValuePercent>10.00</ram:ValuePercent>",
      "</ram:SpecifiedDocumentCharacteristic>",
      "</ram:SpecifiedDocumentStatus>",
    ].join("");
    const xml = franceCdarToXML({ franceCdar: document }).replace(
      "</ram:SpecifiedDocumentStatus>",
      `</ram:SpecifiedDocumentStatus>${secondStatusDetail}`
    );

    expect(parseFranceCdarFromXML(xml)).toEqual(document);
  });

  it("skips a preceding status-history block and projects the current status", () => {
    const document = franceCdarSchema.parse({
      ...request.document,
      id: "CDAR-2026-STATUS-HISTORY",
      issueDate: "2026-07-23T14:05:09",
      phase: "23",
      statusCode: "207",
      reasonCode: "DOUBLON",
      reasonNote: "Current status-detail note.",
      recipientElectronicAddress: parsePeppolAddress(request.recipient).identifier,
      recipientElectronicAddressScheme:
        parsePeppolAddress(request.recipient).schemeId,
    });
    // MDT-115 marks this block as a historical entry for a different status.
    const historyStatusDetail = [
      "<ram:SpecifiedDocumentStatus>",
      "<ram:ReasonCode>AUTRE</ram:ReasonCode>",
      "<ram:Reason>Must not leak from the history block.</ram:Reason>",
      "<ram:ProcessConditionCode>204</ram:ProcessConditionCode>",
      "<ram:SequenceNumeric>1</ram:SequenceNumeric>",
      "<ram:IncludedNote><ram:Content>Must not leak from the history block.</ram:Content></ram:IncludedNote>",
      "</ram:SpecifiedDocumentStatus>",
    ].join("");
    const xml = franceCdarToXML({ franceCdar: document }).replace(
      "<ram:SpecifiedDocumentStatus>",
      `${historyStatusDetail}<ram:SpecifiedDocumentStatus>`
    );

    expect(parseFranceCdarFromXML(xml)).toEqual(document);
  });

  it("projects the first of several acknowledgement blocks", () => {
    const document = franceCdarSchema.parse({
      ...request.document,
      id: "CDAR-2026-MULTI-ACK",
      issueDate: "2026-07-23T14:05:09",
      phase: "23",
      recipientElectronicAddress: parsePeppolAddress(request.recipient).identifier,
      recipientElectronicAddressScheme:
        parsePeppolAddress(request.recipient).schemeId,
    });
    const xml = franceCdarToXML({ franceCdar: document });
    const secondAcknowledgement = xml
      .slice(
        xml.indexOf("<rsm:AcknowledgementDocument>"),
        xml.indexOf("</rsm:AcknowledgementDocument>") +
          "</rsm:AcknowledgementDocument>".length
      )
      .replace("INV-2026-001", "INV-2026-002");

    expect(
      parseFranceCdarFromXML(
        xml.replace(
          "</rsm:AcknowledgementDocument>",
          `</rsm:AcknowledgementDocument>${secondAcknowledgement}`
        )
      )
    ).toEqual(document);
  });

  it("projects the first of several referenced documents", () => {
    const document = franceCdarSchema.parse({
      ...request.document,
      id: "CDAR-2026-MULTI-REF",
      issueDate: "2026-07-23T14:05:09",
      phase: "23",
      recipientElectronicAddress: parsePeppolAddress(request.recipient).identifier,
      recipientElectronicAddressScheme:
        parsePeppolAddress(request.recipient).schemeId,
    });
    const xml = franceCdarToXML({ franceCdar: document });

    const secondReferencedDocument = xml
      .slice(
        xml.indexOf("<ram:ReferenceReferencedDocument>"),
        xml.indexOf("</ram:ReferenceReferencedDocument>") +
          "</ram:ReferenceReferencedDocument>".length
      )
      .replace("INV-2026-001", "INV-2026-002");
    expect(
      parseFranceCdarFromXML(
        xml.replace(
          "</ram:ReferenceReferencedDocument>",
          `</ram:ReferenceReferencedDocument>${secondReferencedDocument}`
        )
      )
    ).toEqual(document);
  });

  it("ignores an unschemed party ID instead of failing the whole document", () => {
    const document = franceCdarSchema.parse({
      ...request.document,
      id: "CDAR-2026-PARTY-ID",
      issueDate: "2026-07-23T14:05:09",
      phase: "23",
      recipientElectronicAddress: parsePeppolAddress(request.recipient).identifier,
      recipientElectronicAddressScheme:
        parsePeppolAddress(request.recipient).schemeId,
    });
    const xml = franceCdarToXML({ franceCdar: document });

    // MDT-55 is free-form internal nomenclature and carries no ISO 6523 scheme.
    expect(
      parseFranceCdarFromXML(
        xml.replace(
          "<ram:RecipientTradeParty>",
          "<ram:RecipientTradeParty><ram:ID>INTERNAL-REF-42</ram:ID>"
        )
      )
    ).toEqual(document);

    // A schemed ram:ID is a usable legal identifier.
    expect(
      parseFranceCdarFromXML(
        xml.replace(
          "<ram:RecipientTradeParty>",
          '<ram:RecipientTradeParty><ram:ID schemeID="0002">987654321</ram:ID>'
        )
      )
    ).toEqual({
      ...document,
      recipientLegalId: "987654321",
      recipientLegalIdScheme: "0002",
    });
  });

  it("retains the first repeated reason within the projected status detail", () => {
    const document = franceCdarSchema.parse({
      ...request.document,
      id: "CDAR-2026-REPEATED-REASON",
      issueDate: "2026-07-23T14:05:09",
      phase: "23",
      statusCode: "207",
      reasonCode: "DOUBLON",
      reason: "First reason.",
      recipientElectronicAddress: parsePeppolAddress(request.recipient).identifier,
      recipientElectronicAddressScheme:
        parsePeppolAddress(request.recipient).schemeId,
    });
    const xml = franceCdarToXML({ franceCdar: document }).replace(
      "<ram:Reason>First reason.</ram:Reason>",
      [
        "<ram:Reason>First reason.</ram:Reason>",
        "<ram:Reason>Second reason.</ram:Reason>",
      ].join("")
    );

    expect(parseFranceCdarFromXML(xml)).toEqual(document);
  });

  it("retains the first Content from the first IncludedNote", () => {
    const document = franceCdarSchema.parse({
      ...request.document,
      id: "CDAR-2026-REPEATED-NOTE",
      issueDate: "2026-07-23T14:05:09",
      phase: "23",
      statusCode: "207",
      reasonCode: "AUTRE",
      reasonNote: "First note.",
      recipientElectronicAddress:
        parsePeppolAddress(request.recipient).identifier,
      recipientElectronicAddressScheme:
        parsePeppolAddress(request.recipient).schemeId,
    });
    const xml = franceCdarToXML({ franceCdar: document })
      .replace(
        "</ram:Content>",
        "</ram:Content><ram:Content>Second content.</ram:Content>"
      )
      .replace(
        "</ram:IncludedNote>",
        [
          "</ram:IncludedNote>",
          "<ram:IncludedNote><ram:Content>Second note.</ram:Content></ram:IncludedNote>",
        ].join("")
      );

    expect(parseFranceCdarFromXML(xml)).toEqual(document);
  });

  it("requires at least one complete collected amount for status 212", () => {
    expect(
      sendFranceCdarSchema.safeParse({
        ...request.document,
        statusCode: "212",
      }).success
    ).toBe(false);
    expect(
      sendFranceCdarSchema.safeParse({
        ...request.document,
        statusCode: "212",
        collectedAmounts: [{ amount: "", currency: "", vatPercent: "" }],
      }).success
    ).toBe(false);
  });

  it("validates collected amount precision, currency, and VAT syntax", () => {
    expect(
      franceCdarCollectedAmountSchema.safeParse({
        amount: "-123456789012.123456",
        currency: "EUR",
        vatPercent: "1.05",
      }).success
    ).toBe(true);
    expect(
      franceCdarCollectedAmountSchema.safeParse({
        amount: "1.00",
        currency: "EUR",
        vatPercent: "21",
      }).success
    ).toBe(true);
    // MDT-215 (MONTANT 19,6) carries no non-zero constraint.
    expect(
      franceCdarCollectedAmountSchema.safeParse({
        amount: "0.00",
        currency: "EUR",
        vatPercent: "20",
      }).success
    ).toBe(true);

    for (const collectedAmount of [
      { amount: "1.1234567", currency: "EUR", vatPercent: "20" },
      { amount: "12345678901234.123456", currency: "EUR", vatPercent: "20" },
      { amount: "1.00", currency: "ZZZ", vatPercent: "20" },
      { amount: "1.00", currency: "EUR", vatPercent: "20.000" },
    ]) {
      expect(franceCdarCollectedAmountSchema.safeParse(collectedAmount).success).toBe(
        false
      );
    }
  });

  it("rejects a MEN amount without its MDT-216 currencyID", () => {
    const document = franceCdarSchema.parse({
      ...request.document,
      id: "CDAR-2026-212",
      issueDate: "2026-07-23T14:05:09",
      phase: "23",
      statusCode: "212",
      recipientElectronicAddress: parsePeppolAddress(request.recipient).identifier,
      recipientElectronicAddressScheme:
        parsePeppolAddress(request.recipient).schemeId,
      collectedAmounts: [
        { amount: "100.00", currency: "EUR", vatPercent: "20.00" },
      ],
    });
    const xmlWithoutCurrency = franceCdarToXML({
      franceCdar: document,
    }).replace(' currencyID="EUR"', "");

    expect(() => parseFranceCdarFromXML(xmlWithoutCurrency)).toThrow();
  });
});
