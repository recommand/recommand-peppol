// Extend fetch with the Phase4 token
export function fetchPhase4Ap(url: string, options: { useTestNetwork?: boolean } & RequestInit) {
  const endpoint = options.useTestNetwork ? "https://test-ap.net.recommand.com" : "https://ap.net.recommand.com";
  const token = options.useTestNetwork ? process.env.PHASE4_AP_TEST_TOKEN : process.env.PHASE4_AP_TOKEN;
  return fetch(endpoint + "/" + url, {
    ...options,
    headers: {
      ...options.headers,
      "X-Token": token!,
    },
  });
}

export type SendAs4Response = {
  ok: boolean;
  peppolMessageId: string | null;
  peppolConversationId: string | null;
  receivedPeppolSignalMessage: string | null;
  sbdhInstanceIdentifier: string | null;
  // The access point provider's own transaction reference, when it exposes one.
  apTransactionId?: string | null;
  sendingException?: {
    message: string;
  };
};

export async function sendAs4(options: {
  senderId: string;
  receiverId: string;
  docTypeId: string;
  processId: string;
  countryC1: string;
  body: BodyInit;
  contentType?: string;
  useTestNetwork: boolean,
}): Promise<SendAs4Response> {
  const { senderId, receiverId, docTypeId, processId, countryC1, body } = options;

  try {
    // Properly encode all the parameters
    const encodedSenderId = encodeURIComponent(senderId);
    const encodedReceiverId = encodeURIComponent(receiverId);
    const encodedDocTypeId = encodeURIComponent(docTypeId);
    const encodedProcessId = encodeURIComponent(processId);
    const encodedCountryC1 = encodeURIComponent(countryC1);

    const result = await fetchPhase4Ap(`/sendas4/${encodedSenderId}/${encodedReceiverId}/${encodedDocTypeId}/${encodedProcessId}/${encodedCountryC1}`, {
      method: 'POST',
      headers: {
        'Content-Type': options.contentType ?? 'application/xml',
      },
      body,
      useTestNetwork: options.useTestNetwork,
    });

    if (!result.ok) {
      return {
        ok: false,
        peppolMessageId: null,
        peppolConversationId: null,
        receivedPeppolSignalMessage: null,
        sbdhInstanceIdentifier: null,
      }
    }

    const resultJson = await result.json();

    return {
      ok: resultJson.overallSuccess,
      sendingException: resultJson.sendingException,
      peppolMessageId: resultJson.as4MessageId ?? null,
      peppolConversationId: resultJson.as4ConversationId ?? null,
      receivedPeppolSignalMessage: resultJson.as4ReceivedSignalMsg ?? null,
      sbdhInstanceIdentifier: resultJson.sbdhInstanceIdentifier ?? null,
    }

  } catch (e) {
    console.error(e);
    return {
      ok: false,
      peppolMessageId: null,
      peppolConversationId: null,
      receivedPeppolSignalMessage: null,
      sbdhInstanceIdentifier: null,
    }
  }
}
