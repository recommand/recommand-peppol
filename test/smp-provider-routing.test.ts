import { afterEach, describe, expect, it, mock } from "bun:test";
import { getSupportedIdentifierSchemes, resolveDefaultPeppolProviders } from "@peppol/data/peppol-providers";
import { findUnsupportedIdentifiers } from "@peppol/data/company-identifier-policy";
import { smpProviderDescriptors, type SmpProviderId } from "@peppol/data/smp-providers/descriptors";

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
      smpProvider: "elma",
    });
    expect(resolveDefaultPeppolProviders("no", { useTestNetwork: false }).smpProvider).toBe("recommand-smp1");

    process.env.ELMA_ENABLED = "true";
    expect(resolveDefaultPeppolProviders("NO", { useTestNetwork: false }).smpProvider).toBe("elma");
  });

  it("leaves other countries where they were", () => {
    process.env.ELMA_ENABLED = "true";
    expect(resolveDefaultPeppolProviders("FR", { useTestNetwork: false }).smpProvider).toBe("at-shared-smp-fr");
    expect(resolveDefaultPeppolProviders("SE", { useTestNetwork: false }).smpProvider).toBe("recommand-smp1");
  });
});

describe("what each SMP supports", () => {
  it("restricts ELMA to Norwegian organisation numbers", () => {
    expect(getSupportedIdentifierSchemes("elma")).toEqual(["0192"]);
    const identifiers = [{ scheme: "0192", identifier: "923609016" }, { scheme: "9908", identifier: "no923609016mva" }];
    expect(findUnsupportedIdentifiers({ smpProvider: "elma" }, identifiers)).toEqual([identifiers[1]]);
    expect(findUnsupportedIdentifiers({ smpProvider: "elma", isPlayground: true }, identifiers)).toEqual([]);
  });

  it("offers SML migration keys on our own SMP only", () => {
    const withKeys = Object.entries(smpProviderDescriptors)
      .filter(([, descriptor]) => descriptor.migrationKeys)
      .map(([id]) => id);
    expect(withKeys).toEqual(["recommand-smp1"]);
  });

  it("republishes company details only where the SMP keeps them", () => {
    expect(smpProviderDescriptors.elma.republishOnCompanyDetailsChange).toBe(true);
    expect(smpProviderDescriptors["recommand-smp1"].republishOnCompanyDetailsChange).toBe(false);
  });
});

function fakeRouting(company: { smpProvider: SmpProviderId; isSmpRecipient: boolean }, options: {
  registered?: boolean;
  identifiers?: { scheme: string; identifier: string }[];
  failOn?: string;
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
      elma: adapter("elma"),
    },
    loadCompany: async () => ({ ...state }),
    loadIdentifiers: async () => options.identifiers ?? [{ scheme: "0192", identifier: "923609016" }],
    checkIdentifiers: async (identifiers) => {
      calls.push(`check ${identifiers.map((identifier) => `${identifier.scheme}:${identifier.identifier}`).join(",")}`);
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
    const { routing, calls } = fakeRouting({ smpProvider: "elma", isSmpRecipient: true });
    await routing.upsertCompanyRegistrations({ companyId: "c_no", useTestNetwork: true });
    expect(calls).toEqual(["check 0192:923609016", "elma.upsertCompanyRegistrations"]);
  });

  it("checks a single identifier before registering it", async () => {
    const { routing, calls } = fakeRouting({ smpProvider: "recommand-smp1", isSmpRecipient: true });
    await routing.upsertCompanyRegistration({ companyId: "c", identifier: { scheme: "0192", identifier: "974760673" }, useTestNetwork: false });
    expect(calls).toEqual(["check 0192:974760673", "recommand-smp1.upsertCompanyRegistration"]);
  });

  it("does not check identifiers of a company that does not receive", async () => {
    const { routing, calls } = fakeRouting({ smpProvider: "elma", isSmpRecipient: false });
    await routing.upsertCompanyRegistrations({ companyId: "c_no", useTestNetwork: true });
    expect(calls).toEqual(["elma.upsertCompanyRegistrations"]);
  });
});

describe("moving a company to another SMP", () => {
  it("takes a published company off the old SMP before registering it on the new one", async () => {
    const { routing, calls, state } = fakeRouting({ smpProvider: "recommand-smp1", isSmpRecipient: true });
    expect(await routing.moveCompanyToSmpProvider({ companyId: "c_no", to: "elma" })).toBe("moved");
    expect(calls).toEqual([
      "check 0192:923609016",
      "recommand-smp1.unregisterCompanyRegistrations",
      "set elma",
      "elma.upsertCompanyRegistrations",
    ]);
    expect(state.smpProvider).toBe("elma");
  });

  it("only changes the record of a company that is not published", async () => {
    const { routing, calls } = fakeRouting({ smpProvider: "recommand-smp1", isSmpRecipient: true }, { registered: false });
    await routing.moveCompanyToSmpProvider({ companyId: "c_no", to: "elma" });
    expect(calls).toEqual(["set elma"]);
  });

  it("puts the company back on the old SMP when the new one refuses it", async () => {
    const { routing, calls, state } = fakeRouting(
      { smpProvider: "recommand-smp1", isSmpRecipient: true },
      { failOn: "elma.upsertCompanyRegistrations" }
    );
    await expect(routing.moveCompanyToSmpProvider({ companyId: "c_no", to: "elma" })).rejects.toThrow("elma refused");
    expect(calls).toEqual([
      "check 0192:923609016",
      "recommand-smp1.unregisterCompanyRegistrations",
      "set elma",
      "elma.upsertCompanyRegistrations",
      "elma.unregisterCompanyRegistrations",
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
    await expect(routing.moveCompanyToSmpProvider({ companyId: "c_no", to: "elma" })).rejects.toThrow("9908:no923609016mva");
    expect(calls).toEqual([]);
  });

  it("does nothing for a company already on the SMP", async () => {
    const { routing, calls } = fakeRouting({ smpProvider: "elma", isSmpRecipient: true });
    expect(await routing.moveCompanyToSmpProvider({ companyId: "c_no", to: "elma" })).toBe("unchanged");
    expect(calls).toEqual([]);
  });
});
