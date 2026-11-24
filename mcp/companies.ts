import { z } from "zod";
import "zod-openapi/extend";
import { registerTool } from "@core/lib/mcp/tools";
import { companyFilters } from "@peppol/api/companies/shared";
import { getCompanies } from "@peppol/data/companies";
import { getCompaniesIdentifiers } from "@peppol/data/company-identifiers";
import { getTeamExtension } from "@peppol/data/teams";
import { shouldRegisterWithSmp } from "@peppol/utils/playground";

registerTool({
  annotations: { openWorldHint: false, readOnlyHint: true },
  description:
    "List the companies the team sends and receives documents for, with their Peppol IDs, whether they're verified and whether they're registered to receive over Peppol. Use it to find the company a document is for.",
  handler: async ({ team }, { enterpriseNumber, limit, page, vatNumber }) => {
    const [companies, teamExtension] = await Promise.all([
      getCompanies(team.id, { enterpriseNumber, vatNumber }),
      getTeamExtension(team.id),
    ]);
    const pageCompanies = companies.slice((page - 1) * limit, page * limit);
    const identifiers = await getCompaniesIdentifiers(pageCompanies.map(({ id }) => id));

    return {
      companies: pageCompanies.map((company) => ({
        country: company.country,
        enterpriseNumber: company.enterpriseNumber,
        id: company.id,
        // Wanting to receive isn't enough: a playground company never is, and some teams' companies only once verified
        isRegisteredOnPeppol: shouldRegisterWithSmp({
          isPlayground: teamExtension?.isPlayground,
          isSmpRecipient: company.isSmpRecipient,
          isVerified: company.isVerified,
          smpProvider: company.smpProvider,
          useTestNetwork: teamExtension?.useTestNetwork,
          verificationRequirements: teamExtension?.verificationRequirements,
        }),
        isVerified: company.isVerified,
        name: company.name,
        peppolIds: identifiers
          .filter(({ companyId }) => companyId === company.id)
          .map(({ identifier, scheme }) => `${scheme}:${identifier}`),
        vatNumber: company.vatNumber,
      })),
      pagination: { limit, page, total: companies.length, totalPages: Math.ceil(companies.length / limit) },
    };
  },
  input: z.object({
    enterpriseNumber: companyFilters.shape.enterpriseNumber.openapi({
      description: "Only the company with this enterprise number.",
    }),
    limit: z.number().int().min(1).max(100).default(50).openapi({
      description: "How many companies per page, at most 100.",
    }),
    page: z.number().int().min(1).default(1).openapi({
      description: "The page to return, from 1.",
    }),
    vatNumber: companyFilters.shape.vatNumber.openapi({
      description: "Only the company with this VAT number.",
    }),
  }),
  name: "list_companies",
  operations: ["getCompanies", "getCompanyIdentifiers"],
  title: "List companies",
});
