import {
  sendAs4 as sendRecommandP1As4,
  type SendAs4Response,
} from "@peppol/data/phase4-ap/client";
import type { AccessPointProviderId } from "@peppol/data/peppol-providers";

export type SendAs4Options = Parameters<typeof sendRecommandP1As4>[0];

type AccessPointProvider = {
  sendAs4(options: SendAs4Options): Promise<SendAs4Response>;
};

const accessPointProviders = {
  "recommand-ap1": {
    sendAs4: sendRecommandP1As4,
  },
} satisfies Record<AccessPointProviderId, AccessPointProvider>;

export function getAccessPointProvider(
  providerId: AccessPointProviderId
): AccessPointProvider {
  return accessPointProviders[providerId];
}

export type { SendAs4Response };
