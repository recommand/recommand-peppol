import { describe, expect, it } from "bun:test";
import {
  CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
  DOCUMENT_TYPE_PRESETS,
  FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO,
  FRANCE_NON_REGULATED_DOCUMENT_TYPE_PRESETS,
  FRANCE_NON_REGULATED_PROCESS_ID,
  FRANCE_REGULATED_PROCESS_ID,
  getDocumentTypeInfo,
  getFranceBillingProcessId,
  INVOICE_DOCUMENT_TYPE_INFO,
  UBL_FRANCE_INVOICE_CIUS_DOCUMENT_TYPE_INFO,
  UBL_FRANCE_INVOICE_CIUS_NON_REGULATED_DOCUMENT_TYPE_INFO,
} from "../utils/document-types";
import { COUNTRIES } from "../utils/countries";
import {
  frenchCountrySpecificSchema,
  getFrenchBusinessProcess,
  isFranceBillingProcessId,
  resolveFrenchProcessId,
} from "../utils/parsing/country-specific/france";
import { resolveDocumentXmlHandler } from "../utils/parsing/document-handlers";
import { resolveCountrySpecificProcessId } from "../utils/parsing/country-specific/process";
import {
  getDocumentFormatByDocTypeId,
  resolveFormatProcessId,
} from "../utils/type-repository/document-formats";

const frenchCountrySpecific = {
  country: "FR" as const,
  billingMode: "S1" as const,
  recoveryCostsNote: "Indemnité forfaitaire de 40 EUR pour frais de recouvrement.",
  latePaymentPenaltiesNote: "Pénalités de retard selon les conditions de paiement.",
  earlyPaymentDiscountNote: "Aucun escompte accordé pour paiement anticipé.",
};

describe("France non-regulated process", () => {
  it("mirrors every French document type onto the non-regulated process", () => {
    for (const preset of FRANCE_NON_REGULATED_DOCUMENT_TYPE_PRESETS) {
      expect(preset.processId).toBe(FRANCE_NON_REGULATED_PROCESS_ID);

      const regulatedCounterpart = DOCUMENT_TYPE_PRESETS.find(
        (candidate) =>
          candidate.docTypeId === preset.docTypeId &&
          candidate.type === preset.type &&
          candidate.processId === FRANCE_REGULATED_PROCESS_ID
      );
      expect(regulatedCounterpart).toBeDefined();
    }
  });

  it("offers both processes as presets without disturbing type lookups", () => {
    for (const preset of FRANCE_NON_REGULATED_DOCUMENT_TYPE_PRESETS) {
      expect(DOCUMENT_TYPE_PRESETS).toContain(preset);
    }

    const titles = DOCUMENT_TYPE_PRESETS.map((preset) => preset.title);
    expect(new Set(titles).size).toBe(titles.length);

    // A preset is one SMP capability to register, so syntaxes that carry invoices and
    // credit notes under the same identifier are offered once under a combined title.
    const capabilities = DOCUMENT_TYPE_PRESETS.map(
      (preset) => `${preset.docTypeId}|${preset.processId}`
    );
    expect(new Set(capabilities).size).toBe(capabilities.length);

    expect(getDocumentTypeInfo("invoice")).toBe(INVOICE_DOCUMENT_TYPE_INFO);
  });

  it("keeps the non-regulated process opt-in for French participants", () => {
    const france = COUNTRIES.find((country) => country.code === "FR");
    const defaultDocumentTypes = france?.defaultDocumentTypes ?? [];

    // Registering both processes by default would put a participant on the AT SMP
    // limit of 20 document types, so companies add the non-regulated ones themselves.
    expect(defaultDocumentTypes.length).toBeGreaterThan(0);
    expect(
      defaultDocumentTypes.every(
        (documentType) => documentType.processId !== FRANCE_NON_REGULATED_PROCESS_ID
      )
    ).toBe(true);
  });

  it("converts non-regulated documents with the regulated handlers", () => {
    const resolved = resolveDocumentXmlHandler(
      UBL_FRANCE_INVOICE_CIUS_NON_REGULATED_DOCUMENT_TYPE_INFO.docTypeId,
      "invoice"
    );
    if (!resolved.ok) throw new Error(resolved.message);

    expect(resolved.handler.docTypeId).toBe(
      UBL_FRANCE_INVOICE_CIUS_DOCUMENT_TYPE_INFO.docTypeId
    );
  });

  it("selects the process from the declared business process", () => {
    expect(getFranceBillingProcessId("REGULATED")).toBe(FRANCE_REGULATED_PROCESS_ID);
    expect(getFranceBillingProcessId("NON_REGULATED")).toBe(
      FRANCE_NON_REGULATED_PROCESS_ID
    );
    expect(isFranceBillingProcessId(INVOICE_DOCUMENT_TYPE_INFO.processId)).toBe(false);

    const nonRegulated = {
      countrySpecific: { ...frenchCountrySpecific, businessProcess: "NON_REGULATED" },
    };
    expect(
      resolveFrenchProcessId(
        CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.processId,
        nonRegulated
      )
    ).toBe(FRANCE_NON_REGULATED_PROCESS_ID);
    expect(
      resolveFrenchProcessId(
        FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.processId,
        nonRegulated
      )
    ).toBe(FRANCE_NON_REGULATED_PROCESS_ID);
    expect(
      resolveFrenchProcessId(FRANCE_NON_REGULATED_PROCESS_ID, {
        countrySpecific: { ...frenchCountrySpecific, businessProcess: "REGULATED" },
      })
    ).toBe(FRANCE_REGULATED_PROCESS_ID);
  });

  it("claims no document it has no say over", () => {
    // Not a French billing process, even though the document declares one.
    expect(
      resolveFrenchProcessId(INVOICE_DOCUMENT_TYPE_INFO.processId, {
        countrySpecific: { ...frenchCountrySpecific, businessProcess: "NON_REGULATED" },
      })
    ).toBeUndefined();
    // French process, but the document leaves the choice open.
    expect(
      resolveFrenchProcessId(CII_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.processId, {
        countrySpecific: frenchCountrySpecific,
      })
    ).toBeUndefined();
    expect(
      resolveFrenchProcessId(FRANCE_NON_REGULATED_PROCESS_ID, undefined)
    ).toBeUndefined();
  });

  it("moves an outgoing document onto the process its country selects", () => {
    const ublFormat = getDocumentFormatByDocTypeId(
      UBL_FRANCE_INVOICE_CIUS_DOCUMENT_TYPE_INFO.docTypeId,
    );
    const facturXFormat = getDocumentFormatByDocTypeId(
      FACTURX_FRANCE_INVOICE_D22B_DOCUMENT_TYPE_INFO.docTypeId,
    );
    if (!ublFormat || !facturXFormat) {
      throw new Error("French invoice format is not registered.");
    }
    const resolveFor = (countrySpecific: unknown) =>
      resolveFormatProcessId(ublFormat, { countrySpecific });

    expect(resolveFor(frenchCountrySpecific)).toBe(FRANCE_REGULATED_PROCESS_ID);
    expect(
      resolveFor({ ...frenchCountrySpecific, businessProcess: "NON_REGULATED" })
    ).toBe(FRANCE_NON_REGULATED_PROCESS_ID);

    expect(
      resolveFormatProcessId(facturXFormat, {
        countrySpecific: {
          ...frenchCountrySpecific,
          businessProcess: "NON_REGULATED",
        },
      }),
    ).toBe(FRANCE_NON_REGULATED_PROCESS_ID);
  });

  it("leaves documents of other countries on their own process", () => {
    expect(
      resolveCountrySpecificProcessId(INVOICE_DOCUMENT_TYPE_INFO.processId, {
        countrySpecific: { country: "BE" },
      })
    ).toBe(INVOICE_DOCUMENT_TYPE_INFO.processId);
    expect(
      resolveCountrySpecificProcessId(FRANCE_NON_REGULATED_PROCESS_ID, undefined)
    ).toBe(FRANCE_NON_REGULATED_PROCESS_ID);
  });

  it("reads the business process from the request document", () => {
    expect(
      getFrenchBusinessProcess({
        countrySpecific: { ...frenchCountrySpecific, businessProcess: "NON_REGULATED" },
      })
    ).toBe("NON_REGULATED");
    expect(getFrenchBusinessProcess({ countrySpecific: frenchCountrySpecific })).toBeUndefined();
    expect(getFrenchBusinessProcess({ countrySpecific: { country: "BE" } })).toBeUndefined();
    expect(getFrenchBusinessProcess("<Invoice/>")).toBeUndefined();
    expect(getFrenchBusinessProcess(undefined)).toBeUndefined();
  });

  it("keeps the business process optional and validated", () => {
    expect(frenchCountrySpecificSchema.safeParse(frenchCountrySpecific).success).toBe(true);
    expect(
      frenchCountrySpecificSchema.safeParse({
        ...frenchCountrySpecific,
        businessProcess: "NON_REGULATED",
      }).success
    ).toBe(true);
    expect(
      frenchCountrySpecificSchema.safeParse({
        ...frenchCountrySpecific,
        businessProcess: "B2C",
      }).success
    ).toBe(false);
  });
});
