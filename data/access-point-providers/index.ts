import {
  sendAs4 as sendRecommandP1As4,
  type SendAs4Response,
} from "@peppol/data/phase4-ap/client";
import {
  downloadBusinessDocument as downloadArratechBusinessDocument,
  sendAs4 as sendArratechAs4,
} from "@peppol/data/at/ap";
import type { AccessPointProviderId } from "@peppol/data/peppol-providers";

export type SendAs4Options = Parameters<typeof sendRecommandP1As4>[0];

export type BusinessDocumentDownload = {
  body: string | Blob;
  contentType: string;
};

type AccessPointProvider = {
  sendAs4(options: SendAs4Options): Promise<SendAs4Response>;
  /**
   * Fetches the business document of one of the provider's transactions. Only
   * providers that report their transactions back to us expose this.
   */
  downloadBusinessDocument?(options: {
    transactionId: string;
    useTestNetwork: boolean;
  }): Promise<BusinessDocumentDownload | null>;
};

const accessPointProviders = {
  "recommand-ap1": {
    sendAs4: sendRecommandP1As4,
  },
  "at-shared-ap-fr": {
    sendAs4: sendArratechAs4,
    downloadBusinessDocument: downloadArratechBusinessDocument,
  },
} satisfies Record<AccessPointProviderId, AccessPointProvider>;

export function getAccessPointProvider(
  providerId: AccessPointProviderId
): AccessPointProvider {
  return accessPointProviders[providerId];
}

export type { SendAs4Response };
