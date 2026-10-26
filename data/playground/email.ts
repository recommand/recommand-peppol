import type { DocumentEmailSender } from "@peppol/data/email/send-document-emails";

// A playground answers as production would and leaves out the delivery, and email is
// a delivery like Peppol is. A document mailed from a playground therefore only
// really goes out to the playground's own members, whose verified addresses are
// where a developer can look at the message. Any other address is simulated: the
// send succeeds and its delivery is recorded as delivered, as a simulated Peppol
// transmission is, but nothing reaches the mail service. This holds for a playground
// on the Peppol Test Network too: there is no test network for email, so an address
// outside the team is always a real mailbox.

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * Wraps the sender of a playground's document emails so only `memberAddresses` are
 * mailed. Every other address is answered as simulated, without a message id.
 */
export function playgroundEmailSender(
  memberAddresses: readonly string[],
  send: DocumentEmailSender
): DocumentEmailSender {
  const members = new Set(memberAddresses.map(normalizeAddress));
  return async (message) =>
    members.has(normalizeAddress(message.to))
      ? await send(message)
      : { messageId: null, simulated: true };
}
