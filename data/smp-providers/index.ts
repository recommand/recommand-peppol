import { companies } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { eq } from "drizzle-orm";
import {
  unregisterCompanyDocumentType as unregisterRecommandP1CompanyDocumentType,
  unregisterCompanyIdentifier as unregisterRecommandP1CompanyIdentifier,
  unregisterCompanyRegistrations as unregisterRecommandP1CompanyRegistrations,
  upsertCompanyRegistration as upsertRecommandP1CompanyRegistration,
  upsertCompanyRegistrations as upsertRecommandP1CompanyRegistrations,
} from "@peppol/data/phoss-smp";
import {
  unregisterCompanyDocumentType as unregisterArratechCompanyDocumentType,
  unregisterCompanyIdentifier as unregisterArratechCompanyIdentifier,
  unregisterCompanyRegistrations as unregisterArratechCompanyRegistrations,
  upsertCompanyRegistration as upsertArratechCompanyRegistration,
  upsertCompanyRegistrations as upsertArratechCompanyRegistrations,
} from "@peppol/data/at/smp";
import type { SmpProviderId } from "@peppol/data/peppol-providers";
import type { CompanyIdentifier } from "@peppol/data/company-identifiers";
import type { CompanyDocumentType } from "@peppol/data/company-document-types";
import { UserFacingError } from "@directory/utils/util";

type MinimalCompanyIdentifier = {
  scheme: string;
  identifier: string;
};

type SmpProvider = {
  upsertCompanyRegistrations(options: {
    companyId: string;
    useTestNetwork: boolean;
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

const smpProviders = {
  "recommand-smp1": {
    upsertCompanyRegistrations: upsertRecommandP1CompanyRegistrations,
    unregisterCompanyRegistrations: unregisterRecommandP1CompanyRegistrations,
    upsertCompanyRegistration: upsertRecommandP1CompanyRegistration,
    unregisterCompanyDocumentType: unregisterRecommandP1CompanyDocumentType,
    unregisterCompanyIdentifier: unregisterRecommandP1CompanyIdentifier,
  },
  "at-shared-smp-fr": {
    upsertCompanyRegistrations: upsertArratechCompanyRegistrations,
    unregisterCompanyRegistrations: unregisterArratechCompanyRegistrations,
    upsertCompanyRegistration: upsertArratechCompanyRegistration,
    unregisterCompanyDocumentType: unregisterArratechCompanyDocumentType,
    unregisterCompanyIdentifier: unregisterArratechCompanyIdentifier,
  },
} satisfies Record<SmpProviderId, SmpProvider>;

async function getSmpProviderForCompanyId(
  companyId: string
): Promise<SmpProvider> {
  const company = await db
    .select({ smpProvider: companies.smpProvider })
    .from(companies)
    .where(eq(companies.id, companyId))
    .then((rows) => rows[0]);

  if (!company) {
    throw new UserFacingError("Company not found");
  }

  return smpProviders[company.smpProvider];
}

export async function upsertCompanyRegistrations(options: {
  companyId: string;
  useTestNetwork: boolean;
}) {
  const provider = await getSmpProviderForCompanyId(options.companyId);
  await provider.upsertCompanyRegistrations(options);
}

export async function unregisterCompanyRegistrations(options: {
  companyId: string;
  useTestNetwork: boolean;
}) {
  const provider = await getSmpProviderForCompanyId(options.companyId);
  await provider.unregisterCompanyRegistrations(options);
}

export async function upsertCompanyRegistration(options: {
  companyId: string;
  identifier: MinimalCompanyIdentifier;
  useTestNetwork: boolean;
}) {
  const provider = await getSmpProviderForCompanyId(options.companyId);
  await provider.upsertCompanyRegistration(options);
}

export async function unregisterCompanyDocumentType(options: {
  documentType: CompanyDocumentType;
  useTestNetwork: boolean;
}) {
  const provider = await getSmpProviderForCompanyId(options.documentType.companyId);
  await provider.unregisterCompanyDocumentType(options);
}

export async function unregisterCompanyIdentifier(options: {
  identifier: CompanyIdentifier;
  useTestNetwork: boolean;
}) {
  const provider = await getSmpProviderForCompanyId(options.identifier.companyId);
  await provider.unregisterCompanyIdentifier(options);
}
