import { z } from "zod";
import "zod-openapi/extend";
import { McpToolError, registerTool } from "@core/lib/mcp/tools";
import { searchPeppolDirectoryWithTotal } from "@peppol/data/peppol-directory";
import { lookUpRecipient } from "@peppol/data/recipient-lookup";
import { getTeamExtension } from "@peppol/data/teams";
import { getDocumentTypeName } from "@peppol/utils/document-type-lookup";

/** The most directory matches handed back: a search for a common name can match thousands. */
const MAX_MATCHES = 20;

type LookedUpRecipient = {
  companyName?: string | null;
  countryCode?: string | null;
  isValid: boolean;
  supportedDocuments?: { name: string }[];
};

/** The names of document types rather than their long IDs, once each: several versions of a type share a name. */
const documentTypeNames = (names: string[]) => [...new Set(names)].toSorted();

registerTool({
  annotations: { openWorldHint: true, readOnlyHint: true },
  description:
    "Find out whether a company can receive documents over Peppol. Give a `peppolAddress` (such as `0208:0123456789`) to check that it's registered and see the document types it accepts, or a `name` to search the Peppol directory for its address first.",
  handler: async ({ team }, { name, peppolAddress }) => {
    if (peppolAddress && !name) {
      // The SMP's addresses only matter to an access point, so they're left out
      const { companyName, countryCode, isValid, supportedDocuments } = (await lookUpRecipient(team.id, {
        includeBusinessCard: true,
        peppolAddress,
      })) as LookedUpRecipient;

      return isValid
        ? {
            companyName: companyName ?? null,
            countryCode: countryCode ?? null,
            isValid,
            supportedDocumentTypes: documentTypeNames((supportedDocuments ?? []).map(({ name }) => name)),
          }
        : { isValid };
    }

    if (!name || peppolAddress) {
      throw new McpToolError("Give either `name` or `peppolAddress`.", "invalid_input");
    }

    const teamExtension = await getTeamExtension(team.id);
    const { matches, total } = await searchPeppolDirectoryWithTotal({
      query: name,
      useTestNetwork: teamExtension?.useTestNetwork ?? false,
    }).catch(() => {
      throw new McpToolError("The Peppol directory is unavailable right now. Try again later.", "directory_unavailable");
    });

    return {
      matches: matches.slice(0, MAX_MATCHES).map((match) => ({
        name: match.name,
        peppolAddress: match.peppolAddress,
        supportedDocumentTypes: documentTypeNames(match.supportedDocumentTypes.map(getDocumentTypeName)),
      })),
      total,
    };
  },
  input: z.object({
    name: z.string().optional().openapi({
      description: "A company name, VAT or enterprise number to search the Peppol directory for.",
    }),
    peppolAddress: z.string().optional().openapi({
      description: "A Peppol address as `scheme:identifier`, to check directly.",
    }),
  }),
  name: "find_recipient",
  operations: ["searchDirectory", "verifyRecipient"],
  title: "Find a recipient",
});
