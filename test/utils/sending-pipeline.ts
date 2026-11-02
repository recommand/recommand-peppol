/**
 * Runs the sending pipeline in-process, without a server, a database or a network.
 *
 * The request goes through the real schema and pipeline. What would leave the process
 * is stubbed: the sending identifier, validation, the access point, the email and the
 * stored document, so a test sees what the pipeline sent and stored.
 */

import { afterEach, beforeEach, mock, spyOn } from "bun:test";

// Nothing under test touches the database, but some of the modules connect at import
// time. Everything that would is stubbed below.
mock.module("@recommand/db", () => ({ db: {} }));

const { sendingPipeline } = await import("../../utils/pipelines/sending");
const { sendDocumentSchema } = await import("../../utils/parsing/send-document");
const companyIdentifiers = await import("../../data/company-identifiers");
const email = await import("../../data/email/send-email");
const metrics = await import("../../utils/metrics");
const validation = await import("../../utils/pipelines/sending/validate-document");
const recording = await import("../../data/record-outgoing-document");
const accessPoints = await import("../../data/access-point-providers");

export const SENDER = { scheme: "0208", identifier: "1234567894" };

export const company = {
  id: "c_1",
  name: "Recommand E2E Seller",
  address: "Teststraat 1",
  postalCode: "1000",
  city: "Brussels",
  country: "BE",
  vatNumber: "BE1234567894",
  enterpriseNumber: "1234567894",
  enterpriseNumberScheme: "0208",
  email: "seller@example.com",
  phone: "+32 2 123 45 67",
  accessPointProvider: "recommand-ap1",
} as any;

type Team = { isPlayground?: boolean; useTestNetwork?: boolean };

function context(input: unknown, team: Team = {}) {
  return {
    req: { valid: () => sendDocumentSchema.parse(input) },
    var: { company, team: { id: "team_1", isPlayground: false, useTestNetwork: false, ...team } },
    set: () => {},
    json: (body: any, status = 200) => ({ body, status }),
  } as any;
}

/** Sends a request body as the send document endpoint would, and returns its response. */
export const send = (input: unknown, team?: Team) =>
  sendingPipeline(context(input, team)) as unknown as Promise<{ body: any; status: number }>;

/**
 * Installs the stubs around every test of the calling file and returns what they
 * record. The lists are emptied and the mocks reset before each test. `sendAs4` answers
 * with `transmission()` unless a test says otherwise; validation passes unless a test
 * says otherwise.
 */
export function useSendingPipeline(options: { transmission: () => unknown }) {
  const sentEmails: { to: string; xmlDocument: string | null }[] = [];
  const recorded: any[] = [];
  const sendAs4 = mock();
  const validateDocument = mock();
  let spies: { mockRestore(): void }[] = [];

  /** Stubs a module export for the current test only. */
  function stub<T extends object, K extends keyof T>(module: T, name: K) {
    const spy = spyOn(module, name as any);
    spies.push(spy);
    return spy;
  }

  beforeEach(() => {
    sentEmails.length = 0;
    recorded.length = 0;
    sendAs4.mockReset();
    sendAs4.mockImplementation(async () => options.transmission());
    validateDocument.mockReset();
    validateDocument.mockResolvedValue({ result: "valid", errors: [] });
    stub(companyIdentifiers, "getSendingCompanyIdentifier").mockResolvedValue(SENDER as any);
    stub(validation, "validateDocument").mockImplementation((...args: any[]) => validateDocument(...args));
    stub(email, "sendDocumentEmail").mockImplementation(async (options: any) => {
      sentEmails.push({ to: options.to, xmlDocument: options.xmlDocument });
      return { messageId: `msg-${sentEmails.length}` };
    });
    stub(accessPoints, "getAccessPointProvider").mockReturnValue({ sendAs4: (options: unknown) => sendAs4(options) } as any);
    stub(recording, "recordOutgoingDocument").mockImplementation(async (options: any) => {
      recorded.push(options);
      return { id: options.id, deliveries: [] } as any;
    });
    stub(metrics, "recordSendDocumentDelivery").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies = [];
  });

  return { sentEmails, recorded, sendAs4, validateDocument, stub };
}
