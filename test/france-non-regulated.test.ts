import { describe, expect, it } from "bun:test";
import {
  FRANCE_NON_REGULATED_PROCESS_ID,
  FRANCE_REGULATED_PROCESS_ID,
  getFranceBillingProcessId,
} from "../utils/type-repository/document-formats/france-process";
import { COUNTRIES } from "../utils/countries";
import {
  frenchCountrySpecificSchema,
  getFrenchBusinessProcess,
  isFranceBillingProcessId,
  resolveFrenchProcessId,
} from "../utils/parsing/country-specific/france";
import { resolveCountrySpecificProcessId } from "../utils/parsing/country-specific/process";
import {
  getDocumentFormat,
  getDocumentFormatByDocTypeId,
  getDocumentFormatsByDocumentTypeKey,
  resolveFormatProcessId,
} from "../utils/type-repository/document-formats";
import { receivingCapabilities } from "../utils/type-repository/receiving-capabilities";
import { peppolUblBis3InvoiceFormat } from "../utils/type-repository/document-formats/peppol-ubl-bis3-invoice";
import { ublFranceCiusInvoiceFormat } from "../utils/type-repository/document-formats/ubl-france-cius-invoice";
import { facturxFranceFormat } from "../utils/type-repository/document-formats/facturx-france";

const PEPPOL_BILLING_PROCESS_ID =
  "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
const franceNonRegulatedReceivingCapabilities = receivingCapabilities.filter(
  (capability) => capability.processId === FRANCE_NON_REGULATED_PROCESS_ID,
);

const frenchCountrySpecific = {
  country: "FR" as const,
  billingMode: "S1" as const,
  recoveryCostsNote: "Indemnité forfaitaire de 40 EUR pour frais de recouvrement.",
  latePaymentPenaltiesNote: "Pénalités de retard selon les conditions de paiement.",
  earlyPaymentDiscountNote: "Aucun escompte accordé pour paiement anticipé.",
};

describe("France non-regulated process", () => {
  it("keeps receiving capabilities aligned with registered formats", () => {
    for (const capability of receivingCapabilities) {
      if (capability.formatKey === "peppol-ubl-invoice-response") continue;
      const format = getDocumentFormat(capability.formatKey);
      expect(format, capability.formatKey).toBeDefined();
      expect(format?.docTypeId).toBe(capability.docTypeId);
      expect(format?.supportedProcessIds).toContain(capability.processId);
    }
  });

  it("mirrors every French document type onto the non-regulated process", () => {
    for (const preset of franceNonRegulatedReceivingCapabilities) {
      expect(preset.processId).toBe(FRANCE_NON_REGULATED_PROCESS_ID);

      const regulatedCounterpart = receivingCapabilities.find(
        (candidate) =>
          candidate.docTypeId === preset.docTypeId &&
          candidate.processId === FRANCE_REGULATED_PROCESS_ID
      );
      expect(regulatedCounterpart).toBeDefined();
    }
  });

  it("offers both processes as presets without disturbing type lookups", () => {
    for (const preset of franceNonRegulatedReceivingCapabilities) {
      expect(receivingCapabilities).toContain(preset);
    }

    const titles = receivingCapabilities.map((preset) => preset.translatableTitle);
    expect(new Set(titles).size).toBe(titles.length);

    // A preset is one SMP capability to register, so syntaxes that carry invoices and
    // credit notes under the same identifier are offered once under a combined title.
    const capabilities = receivingCapabilities.map(
      (preset) => `${preset.docTypeId}|${preset.processId}`
    );
    expect(new Set(capabilities).size).toBe(capabilities.length);

    expect(getDocumentFormatsByDocumentTypeKey("invoice")[0]).toBe(
      peppolUblBis3InvoiceFormat,
    );
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

  it("uses the same format for regulated and non-regulated capabilities", () => {
    const nonRegulatedCapability = franceNonRegulatedReceivingCapabilities.find(
      (capability) => capability.formatKey === ublFranceCiusInvoiceFormat.key,
    );
    expect(nonRegulatedCapability).toBeDefined();
    expect(getDocumentFormatByDocTypeId(nonRegulatedCapability!.docTypeId)).toBe(
      ublFranceCiusInvoiceFormat,
    );
  });

  it("selects the process from the declared business process", () => {
    expect(getFranceBillingProcessId("REGULATED")).toBe(FRANCE_REGULATED_PROCESS_ID);
    expect(getFranceBillingProcessId("NON_REGULATED")).toBe(
      FRANCE_NON_REGULATED_PROCESS_ID
    );
    expect(isFranceBillingProcessId(PEPPOL_BILLING_PROCESS_ID)).toBe(false);

    const nonRegulated = {
      countrySpecific: { ...frenchCountrySpecific, businessProcess: "NON_REGULATED" },
    };
    expect(
      resolveFrenchProcessId(
        FRANCE_REGULATED_PROCESS_ID,
        nonRegulated
      )
    ).toBe(FRANCE_NON_REGULATED_PROCESS_ID);
    expect(
      resolveFrenchProcessId(
        FRANCE_REGULATED_PROCESS_ID,
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
      resolveFrenchProcessId(PEPPOL_BILLING_PROCESS_ID, {
        countrySpecific: { ...frenchCountrySpecific, businessProcess: "NON_REGULATED" },
      })
    ).toBeUndefined();
    // French process, but the document leaves the choice open.
    expect(
      resolveFrenchProcessId(FRANCE_REGULATED_PROCESS_ID, {
        countrySpecific: frenchCountrySpecific,
      })
    ).toBeUndefined();
    expect(
      resolveFrenchProcessId(FRANCE_NON_REGULATED_PROCESS_ID, undefined)
    ).toBeUndefined();
  });

  it("moves an outgoing document onto the process its country selects", () => {
    const ublFormat = getDocumentFormatByDocTypeId(
      ublFranceCiusInvoiceFormat.docTypeId,
    );
    const facturXFormat = getDocumentFormatByDocTypeId(
      facturxFranceFormat.docTypeId,
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
      resolveCountrySpecificProcessId(PEPPOL_BILLING_PROCESS_ID, {
        countrySpecific: { country: "BE" },
      })
    ).toBe(PEPPOL_BILLING_PROCESS_ID);
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
