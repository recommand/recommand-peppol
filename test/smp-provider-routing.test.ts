import { afterEach, describe, expect, it, mock } from "bun:test";
import { getSupportedIdentifierSchemes, resolveDefaultPeppolProviders } from "@peppol/data/peppol-providers";
import { findUnsupportedIdentifiers } from "@peppol/data/company-identifier-policy";
import { smpProviderDescriptors, type SmpProviderId } from "@peppol/data/smp-providers/descriptors";
import { assertIdentifiersRegistrable } from "@peppol/data/identifier-registration-checks";
import { assertNorwegianOrganisationsRegistrable } from "@peppol/data/bronnoysund/organisation-check";
import type { CompanyDocumentType } from "@peppol/data/company-document-types";

// Routing is tested through injected adapters; the database is never reached.
mock.module("@recommand/db", () => ({ db: {} }));
const { createSmpRouting } = await import("@peppol/data/smp-providers");
type Dependencies = Parameters<typeof createSmpRouting>[0];

const ELMA_FLAGS = ["ELMA_ENABLED", "ELMA_TEST_ENABLED"] as const;
const savedFlags = Object.fromEntries(ELMA_FLAGS.map((name) => [name, process.env[name]]));
afterEach(() => {
  for (const name of ELMA_FLAGS) {
    if (savedFlags[name] === undefined) delete process.env[name];
    else process.env[name] = savedFlags[name];
  }
});

describe("choosing the providers of a Norwegian company", () => {
  it("keeps Norway on our own SMP until ELMA is switched on for the network", () => {
    delete process.env.ELMA_ENABLED;
    delete process.env.ELMA_TEST_ENABLED;
    for (const useTestNetwork of [false, true]) {
      expect(resolveDefaultPeppolProviders("NO", { useTestNetwork })).toEqual({
        accessPointProvider: "recommand-ap1",
        smpProvider: "recommand-smp1",
      });
    }
  });

  it("registers Norway in ELMA with our own access point once it is switched on, per network", () => {
    process.env.ELMA_TEST_ENABLED = "true";
    delete process.env.ELMA_ENABLED;
    expect(resolveDefaultPeppolProviders("NO", { useTestNetwork: true })).toEqual({
      accessPointProvider: "recommand-ap1",
      smpProvider: "elma-smp-no",
    });
    expect(resolveDefaultPeppolProviders("no", { useTestNetwork: false }).smpProvider).toBe("recommand-smp1");

    process.env.ELMA_ENABLED = "true";
    expect(resolveDefaultPeppolProviders("NO", { useTestNetwork: false }).smpProvider).toBe("elma-smp-no");
  });

  it("leaves other countries where they were", () => {
    process.env.ELMA_ENABLED = "true";
    expect(resolveDefaultPeppolProviders("FR", { useTestNetwork: false }).smpProvider).toBe("at-shared-smp-fr");
    expect(resolveDefaultPeppolProviders("SE", { useTestNetwork: false }).smpProvider).toBe("recommand-smp1");
  });
});

describe("what each SMP supports", () => {
  it("restricts ELMA to Norwegian organisation numbers", () => {
    expect(getSupportedIdentifierSchemes("elma-smp-no")).toEqual(["0192"]);
    const identifiers = [{ scheme: "0192", identifier: "923609016" }, { scheme: "9908", identifier: "no923609016mva" }];
    expect(findUnsupportedIdentifiers({ smpProvider: "elma-smp-no" }, identifiers)).toEqual([identifiers[1]]);
    expect(findUnsupportedIdentifiers({ smpProvider: "elma-smp-no", isPlayground: true }, identifiers)).toEqual([]);
  });

  it("offers SML migration keys on our own SMP only", () => {
    const withKeys = Object.entries(smpProviderDescriptors)
      .filter(([, descriptor]) => descriptor.migrationKeys)
      .map(([id]) => id);
    expect(withKeys).toEqual(["recommand-smp1"]);
  });

  it("republishes company details only where the SMP keeps them", () => {
    expect(smpProviderDescriptors["elma-smp-no"].republishOnCompanyDetailsChange).toBe(true);
    expect(smpProviderDescriptors["recommand-smp1"].republishOnCompanyDetailsChange).toBe(false);
  });
});

function fakeRouting(company: { smpProvider: SmpProviderId; isSmpRecipient: boolean }, options: {
  registered?: boolean;
  identifiers?: { scheme: string; identifier: string }[];
  failOn?: string;
  checkIdentifiers?: Dependencies["checkIdentifiers"];
} = {}) {
  const calls: string[] = [];
  const state = { ...company };
  const adapter = (id: SmpProviderId) => {
    const record = (name: string) => async () => {
      calls.push(`${id}.${name}`);
      if (options.failOn === `${id}.${name}`) throw new Error(`${id} refused`);
    };
    return {
      upsertCompanyRegistrations: record("upsertCompanyRegistrations"),
      unregisterCompanyRegistrations: record("unregisterCompanyRegistrations"),
      upsertCompanyRegistration: record("upsertCompanyRegistration"),
      unregisterCompanyDocumentType: record("unregisterCompanyDocumentType"),
      unregisterCompanyIdentifier: record("unregisterCompanyIdentifier"),
    };
  };
  const dependencies: Dependencies = {
    adapters: {
      "recommand-smp1": adapter("recommand-smp1"),
      "at-shared-smp-fr": adapter("at-shared-smp-fr"),
      "elma-smp-no": adapter("elma-smp-no"),
    },
    loadCompany: async () => ({ ...state }),
    loadIdentifiers: async () => options.identifiers ?? [{ scheme: "0192", identifier: "923609016" }],
    checkIdentifiers: async (identifiers, network) => {
      calls.push(`check ${identifiers.map((identifier) => `${identifier.scheme}:${identifier.identifier}`).join(",")}`);
      await options.checkIdentifiers?.(identifiers, network);
    },
    loadRegistrationState: async () => ({ registered: options.registered ?? true, useTestNetwork: true }),
    setSmpProvider: async (_companyId, provider) => {
      calls.push(`set ${provider}`);
      state.smpProvider = provider;
    },
  };
  return { routing: createSmpRouting(dependencies), calls, state };
}

describe("routing registrations to the company's SMP", () => {
  it("registers a Norwegian company on ELMA after checking its identifiers", async () => {
    const { routing, calls } = fakeRouting({ smpProvider: "elma-smp-no", isSmpRecipient: true });
    await routing.upsertCompanyRegistrations({ companyId: "c_no", useTestNetwork: true });
    expect(calls).toEqual(["check 0192:923609016", "elma-smp-no.upsertCompanyRegistrations"]);
  });

  it("checks a single identifier before registering it", async () => {
    const { routing, calls } = fakeRouting({ smpProvider: "recommand-smp1", isSmpRecipient: true });
    await routing.upsertCompanyRegistration({ companyId: "c", identifier: { scheme: "0192", identifier: "974760673" }, useTestNetwork: false });
    expect(calls).toEqual(["check 0192:974760673", "recommand-smp1.upsertCompanyRegistration"]);
  });

  it("does not check identifiers of a company that does not receive", async () => {
    const { routing, calls } = fakeRouting({ smpProvider: "elma-smp-no", isSmpRecipient: false });
    await routing.upsertCompanyRegistrations({ companyId: "c_no", useTestNetwork: true });
    expect(calls).toEqual(["elma-smp-no.upsertCompanyRegistrations"]);
  });
});

describe("moving a company to another SMP", () => {
  it("takes a published company off the old SMP before registering it on the new one", async () => {
    const { routing, calls, state } = fakeRouting({ smpProvider: "recommand-smp1", isSmpRecipient: true });
    expect(await routing.moveCompanyToSmpProvider({ companyId: "c_no", to: "elma-smp-no" })).toBe("moved");
    expect(calls).toEqual([
      "check 0192:923609016",
      "recommand-smp1.unregisterCompanyRegistrations",
      "set elma-smp-no",
      "elma-smp-no.upsertCompanyRegistrations",
    ]);
    expect(state.smpProvider).toBe("elma-smp-no");
  });

  it("only changes the record of a company that is not published", async () => {
    const { routing, calls } = fakeRouting({ smpProvider: "recommand-smp1", isSmpRecipient: true }, { registered: false });
    await routing.moveCompanyToSmpProvider({ companyId: "c_no", to: "elma-smp-no" });
    expect(calls).toEqual(["set elma-smp-no"]);
  });

  it("puts the company back on the old SMP when the new one refuses it", async () => {
    const { routing, calls, state } = fakeRouting(
      { smpProvider: "recommand-smp1", isSmpRecipient: true },
      { failOn: "elma-smp-no.upsertCompanyRegistrations" }
    );
    await expect(routing.moveCompanyToSmpProvider({ companyId: "c_no", to: "elma-smp-no" })).rejects.toThrow("elma-smp-no refused");
    expect(calls).toEqual([
      "check 0192:923609016",
      "recommand-smp1.unregisterCompanyRegistrations",
      "set elma-smp-no",
      "elma-smp-no.upsertCompanyRegistrations",
      "elma-smp-no.unregisterCompanyRegistrations",
      "set recommand-smp1",
      "recommand-smp1.upsertCompanyRegistrations",
    ]);
    expect(state.smpProvider).toBe("recommand-smp1");
  });

  it("refuses before touching anything when the new SMP cannot register an identifier", async () => {
    const { routing, calls } = fakeRouting(
      { smpProvider: "recommand-smp1", isSmpRecipient: true },
      { identifiers: [{ scheme: "0192", identifier: "923609016" }, { scheme: "9908", identifier: "no923609016mva" }] }
    );
    await expect(routing.moveCompanyToSmpProvider({ companyId: "c_no", to: "elma-smp-no" })).rejects.toThrow("9908:no923609016mva");
    expect(calls).toEqual([]);
  });

  it("does nothing for a company already on the SMP", async () => {
    const { routing, calls } = fakeRouting({ smpProvider: "elma-smp-no", isSmpRecipient: true });
    expect(await routing.moveCompanyToSmpProvider({ companyId: "c_no", to: "elma-smp-no" })).toBe("unchanged");
    expect(calls).toEqual([]);
  });
});

describe("changing a published document type", () => {
  const documentType = (id: string, docTypeId: string): CompanyDocumentType =>
    ({ id, companyId: "c", docTypeId, processId: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0" }) as CompanyDocumentType;
  const previous = documentType("dt", "invoice");
  const next = documentType("dt", "credit-note");
  // A Belgian company that also holds a Norwegian organisation number: every
  // identifier is published on our own SMP, and the 0192 one is checked against
  // Enhetsregisteret before the company is published.
  const identifiers = [{ scheme: "0208", identifier: "0123456749" }, { scheme: "0192", identifier: "974760673" }];
  const unknownInEnhetsregisteret: Dependencies["checkIdentifiers"] = (checked, network) =>
    assertIdentifiersRegistrable(checked, network, {
      "0192": (underScheme) =>
        assertNorwegianOrganisationsRegistrable(underScheme, {
          fetch: (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch,
          retryDelaysMs: [],
        }),
    });

  it("takes the previous document type off and publishes the current ones after checking the identifiers", async () => {
    const { routing, calls } = fakeRouting({ smpProvider: "recommand-smp1", isSmpRecipient: true }, { identifiers });
    await routing.replaceCompanyDocumentType({ previous, next, useTestNetwork: false, restoreRecord: async () => { calls.push("restore record"); } });
    expect(calls).toEqual([
      "check 0208:0123456749,0192:974760673",
      "recommand-smp1.unregisterCompanyDocumentType",
      "recommand-smp1.upsertCompanyRegistrations",
    ]);
  });

  it("leaves the SMP alone when the register refuses an identifier", async () => {
    const { routing, calls } = fakeRouting(
      { smpProvider: "recommand-smp1", isSmpRecipient: true },
      { identifiers, checkIdentifiers: unknownInEnhetsregisteret }
    );
    await expect(
      routing.replaceCompanyDocumentType({ previous, next, useTestNetwork: false, restoreRecord: async () => { calls.push("restore record"); } })
    ).rejects.toThrow("not registered in Enhetsregisteret");
    expect(calls).toEqual(["check 0208:0123456749,0192:974760673", "restore record"]);
  });

  it("publishes the previous document type again when the SMP fails after it was taken off", async () => {
    const { routing, calls } = fakeRouting(
      { smpProvider: "recommand-smp1", isSmpRecipient: true },
      { identifiers, failOn: "recommand-smp1.upsertCompanyRegistrations" }
    );
    await expect(
      routing.replaceCompanyDocumentType({ previous, next, useTestNetwork: false, restoreRecord: async () => { calls.push("restore record"); } })
    ).rejects.toThrow("recommand-smp1 refused");
    expect(calls).toEqual([
      "check 0208:0123456749,0192:974760673",
      "recommand-smp1.unregisterCompanyDocumentType",
      "recommand-smp1.upsertCompanyRegistrations",
      // What the failed publication may have left of the new document type goes,
      // then the company is published again from the restored record.
      "recommand-smp1.unregisterCompanyDocumentType",
      "restore record",
      "recommand-smp1.upsertCompanyRegistrations",
    ]);
  });

  it("does not check the identifiers of a company that does not receive", async () => {
    const { routing, calls } = fakeRouting(
      { smpProvider: "recommand-smp1", isSmpRecipient: false },
      { identifiers, checkIdentifiers: unknownInEnhetsregisteret }
    );
    await routing.replaceCompanyDocumentType({ previous, next, useTestNetwork: false, restoreRecord: async () => { calls.push("restore record"); } });
    expect(calls).toEqual(["recommand-smp1.unregisterCompanyDocumentType", "recommand-smp1.upsertCompanyRegistrations"]);
  });
});
