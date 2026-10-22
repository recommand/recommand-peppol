import { companies } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { eq } from "drizzle-orm";
import * as recommandSmp from "@peppol/data/phoss-smp";
import * as arratechSmp from "@peppol/data/at/smp";
import * as elmaSmp from "@peppol/data/elma/smp";
import type { CompanyIdentifier } from "@peppol/data/company-identifiers";
import type { CompanyDocumentType } from "@peppol/data/company-document-types";
import { getCompanyIdentifiers } from "@peppol/data/company-identifiers";
import { getTeamExtensionAndCompanyByCompanyId } from "@peppol/data/teams";
import { assertIdentifiersRegistrable } from "@peppol/data/identifier-registration-checks";
import { shouldRegisterWithSmp } from "@peppol/utils/playground";
import { UserFacingError } from "@peppol/utils/util";
import { getSmpProviderDescriptor, type SmpProviderId } from "./descriptors";

// Every company is registered on one SMP, recorded in companies.smpProvider and chosen
// from its country when it is created. This module routes registrations to that
// SMP's adapter. What differs between SMPs beyond how they register is described in
// ./descriptors.

type MinimalCompanyIdentifier = {
  scheme: string;
  identifier: string;
};

/** What every SMP adapter implements. */
export type SmpProviderAdapter = {
  upsertCompanyRegistrations(options: {
    companyId: string;
    useTestNetwork: boolean;
    includeCapabilities?: boolean;
  }): Promise<void>;
  unregisterCompanyRegistrations(options: {
    companyId: string;
    useTestNetwork: boolean;
  }): Promise<void>;
  upsertCompanyRegistration(options: {
    companyId: string;
    identifier: MinimalCompanyIdentifier;
    useTestNetwork: boolean;
  }): Promise<void>;
  unregisterCompanyDocumentType(options: {
    documentType: CompanyDocumentType;
    useTestNetwork: boolean;
  }): Promise<void>;
  unregisterCompanyIdentifier(options: {
    identifier: CompanyIdentifier;
    useTestNetwork: boolean;
  }): Promise<void>;
};

const adapters = {
  "recommand-smp1": recommandSmp,
  "at-shared-smp-fr": arratechSmp,
  "elma-smp-no": elmaSmp,
} satisfies Record<SmpProviderId, SmpProviderAdapter>;

export type SmpRoutingDependencies = {
  adapters: Record<SmpProviderId, SmpProviderAdapter>;
  loadCompany(companyId: string): Promise<{ smpProvider: SmpProviderId; isSmpRecipient: boolean } | undefined>;
  loadIdentifiers(companyId: string): Promise<MinimalCompanyIdentifier[]>;
  /** Refuses identifiers that a national register says cannot be registered on the network. */
  checkIdentifiers(identifiers: readonly MinimalCompanyIdentifier[], network: { useTestNetwork: boolean }): Promise<void>;
  /** Whether the company is published on its SMP now, and on which network. */
  loadRegistrationState(companyId: string): Promise<{ registered: boolean; useTestNetwork: boolean }>;
  setSmpProvider(companyId: string, provider: SmpProviderId): Promise<void>;
};

export function createSmpRouting(dependencies: SmpRoutingDependencies) {
  async function route(companyId: string) {
    const company = await dependencies.loadCompany(companyId);
    if (!company) {
      throw new UserFacingError("Company not found");
    }
    return { company, adapter: dependencies.adapters[company.smpProvider] };
  }

  return {
    async upsertCompanyRegistrations(options: { companyId: string; useTestNetwork: boolean; includeCapabilities?: boolean }) {
      const { company, adapter } = await route(options.companyId);
      if (company.isSmpRecipient) {
        await dependencies.checkIdentifiers(await dependencies.loadIdentifiers(options.companyId), options);
      }
      await adapter.upsertCompanyRegistrations(options);
    },

    async unregisterCompanyRegistrations(options: { companyId: string; useTestNetwork: boolean }) {
      const { adapter } = await route(options.companyId);
      await adapter.unregisterCompanyRegistrations(options);
    },

    async upsertCompanyRegistration(options: { companyId: string; identifier: MinimalCompanyIdentifier; useTestNetwork: boolean }) {
      const { company, adapter } = await route(options.companyId);
      if (company.isSmpRecipient) {
        await dependencies.checkIdentifiers([options.identifier], options);
      }
      await adapter.upsertCompanyRegistration(options);
    },

    async unregisterCompanyDocumentType(options: { documentType: CompanyDocumentType; useTestNetwork: boolean }) {
      const { adapter } = await route(options.documentType.companyId);
      await adapter.unregisterCompanyDocumentType(options);
    },

    async unregisterCompanyIdentifier(options: { identifier: CompanyIdentifier; useTestNetwork: boolean }) {
      const { adapter } = await route(options.identifier.companyId);
      await adapter.unregisterCompanyIdentifier(options);
    },

    /**
     * Publishes a document type whose record changed from `previous` to `next`. An
     * SMP keeps a registration per document type, so the previous one is taken off
     * before the company's current document types are published.
     *
     * The identifiers are checked before the SMP is touched, so a refusal leaves the
     * published document types as they were. If the SMP fails after the previous
     * document type was taken off, whatever was published of `next` is taken off,
     * `restoreRecord` puts the stored document type back, and the company is
     * published again as it was. `restoreRecord` runs on every failure.
     */
    async replaceCompanyDocumentType({
      previous,
      next,
      useTestNetwork,
      restoreRecord,
    }: {
      previous: CompanyDocumentType;
      next: CompanyDocumentType;
      useTestNetwork: boolean;
      restoreRecord: () => Promise<void>;
    }) {
      const companyId = previous.companyId;
      let adapter: SmpProviderAdapter;
      try {
        const routed = await route(companyId);
        adapter = routed.adapter;
        if (routed.company.isSmpRecipient) {
          await dependencies.checkIdentifiers(await dependencies.loadIdentifiers(companyId), { useTestNetwork });
        }
      } catch (error) {
        await restoreRecord();
        throw error;
      }

      try {
        await adapter.unregisterCompanyDocumentType({ documentType: previous, useTestNetwork });
        await adapter.upsertCompanyRegistrations({ companyId, useTestNetwork });
      } catch (error) {
        try {
          await adapter.unregisterCompanyDocumentType({ documentType: next, useTestNetwork });
        } catch (cleanupError) {
          console.error(`Failed to take document type ${next.id} of company ${companyId} off its SMP after publishing it failed:`, cleanupError);
        }
        await restoreRecord();
        try {
          // The identifiers were checked when the company was published with them, and
          // this puts back what was published then, so it is not checked again.
          await adapter.upsertCompanyRegistrations({ companyId, useTestNetwork });
        } catch (restoreError) {
          console.error(`Failed to publish company ${companyId} again after changing document type ${previous.id} failed:`, restoreError);
        }
        throw error;
      }
    },

    /**
     * Moves a company to another SMP. A company that is published is taken off its
     * current SMP and registered on the new one; if the new SMP refuses, the company
     * goes back to the old one. A company that is not published only changes its
     * record.
     *
     * Between the two steps the participant is in neither SMP. The SML entry of the
     * old SMP is removed first, because the new SMP cannot claim a participant the
     * SML still points elsewhere, and the new entry follows as soon as the new SMP
     * publishes it. Moves between SMPs that support migration keys should use those
     * instead (see participant-migrations).
     */
    async moveCompanyToSmpProvider({ companyId, to }: { companyId: string; to: SmpProviderId }): Promise<"moved" | "unchanged"> {
      const { company, adapter: from } = await route(companyId);
      if (company.smpProvider === to) {
        return "unchanged";
      }
      const identifiers = await dependencies.loadIdentifiers(companyId);
      const schemes = getSmpProviderDescriptor(to).identifierSchemes;
      const unsupported = schemes ? identifiers.filter((identifier) => !schemes.includes(identifier.scheme)) : [];
      if (unsupported.length > 0) {
        throw new UserFacingError(
          `The company cannot move to ${to}: it does not register ${unsupported.map((identifier) => `${identifier.scheme}:${identifier.identifier}`).join(", ")}.`
        );
      }

      const { registered, useTestNetwork } = await dependencies.loadRegistrationState(companyId);
      if (!registered) {
        await dependencies.setSmpProvider(companyId, to);
        return "moved";
      }

      await dependencies.checkIdentifiers(identifiers, { useTestNetwork });
      await from.unregisterCompanyRegistrations({ companyId, useTestNetwork });
      await dependencies.setSmpProvider(companyId, to);
      try {
        await dependencies.adapters[to].upsertCompanyRegistrations({ companyId, useTestNetwork });
      } catch (error) {
        try {
          await dependencies.adapters[to].unregisterCompanyRegistrations({ companyId, useTestNetwork });
        } catch (cleanupError) {
          console.error(`Failed to clean up ${to} after moving company ${companyId} failed:`, cleanupError);
        }
        await dependencies.setSmpProvider(companyId, company.smpProvider);
        try {
          await from.upsertCompanyRegistrations({ companyId, useTestNetwork });
        } catch (restoreError) {
          console.error(`Failed to restore company ${companyId} on ${company.smpProvider} after moving it failed:`, restoreError);
        }
        throw error;
      }
      return "moved";
    },
  };
}

const routing = createSmpRouting({
  adapters,
  loadCompany: async (companyId) =>
    await db
      .select({ smpProvider: companies.smpProvider, isSmpRecipient: companies.isSmpRecipient })
      .from(companies)
      .where(eq(companies.id, companyId))
      .then((rows) => rows[0]),
  loadIdentifiers: (companyId) => getCompanyIdentifiers(companyId),
  checkIdentifiers: (identifiers, network) => assertIdentifiersRegistrable(identifiers, network),
  loadRegistrationState: async (companyId) => {
    const context = await getTeamExtensionAndCompanyByCompanyId(companyId);
    if (!context) {
      throw new UserFacingError("Company not found");
    }
    const { company, teamExtension } = context;
    const useTestNetwork = teamExtension?.useTestNetwork ?? false;
    return {
      useTestNetwork,
      registered: shouldRegisterWithSmp({
        isPlayground: teamExtension?.isPlayground ?? false,
        useTestNetwork,
        isSmpRecipient: company.isSmpRecipient,
        isVerified: company.isVerified,
        verificationRequirements: teamExtension?.verificationRequirements ?? undefined,
        smpProvider: company.smpProvider,
      }),
    };
  },
  setSmpProvider: async (companyId, provider) => {
    await db.update(companies).set({ smpProvider: provider }).where(eq(companies.id, companyId));
  },
});

export const upsertCompanyRegistrations = routing.upsertCompanyRegistrations;
export const unregisterCompanyRegistrations = routing.unregisterCompanyRegistrations;
export const upsertCompanyRegistration = routing.upsertCompanyRegistration;
export const unregisterCompanyDocumentType = routing.unregisterCompanyDocumentType;
export const unregisterCompanyIdentifier = routing.unregisterCompanyIdentifier;
export const replaceCompanyDocumentType = routing.replaceCompanyDocumentType;
export const moveCompanyToSmpProvider = routing.moveCompanyToSmpProvider;
