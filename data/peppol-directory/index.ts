import { fetchPeppolDirectory } from "./client";

export type PeppolDirectorySearchResult = {
  peppolAddress: string;
  name: string;
  supportedDocumentTypes: string[];
}

/** A directory search's first page of matches, with how many participants match in all. */
export const searchPeppolDirectoryWithTotal = async ({ query, useTestNetwork }: { query: string; useTestNetwork: boolean }) => {
  const encodedQuery = encodeURIComponent(query);
  const response = await fetchPeppolDirectory(`search/1.0/json?q=${encodedQuery}`, { useTestNetwork });
  const data = await response.json();
  const matches: PeppolDirectorySearchResult[] = data.matches.map((match: any) => ({
    peppolAddress: match.participantID.value,
    name: match.entities?.[0]?.name?.[0]?.name ?? '',
    supportedDocumentTypes: match.docTypes?.map((doc: any) => doc.value) ?? []
  }));

  return { matches, total: (data["total-result-count"] as number | undefined) ?? matches.length };
};

export const searchPeppolDirectory = async ({
  query,
  useTestNetwork,
}: {
  query: string;
  useTestNetwork: boolean;
}): Promise<PeppolDirectorySearchResult[]> => (await searchPeppolDirectoryWithTotal({ query, useTestNetwork })).matches;
