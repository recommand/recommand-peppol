/**
 * End-to-end test suite for the send document API.
 *
 * Runs every combination of the API's parameters against a real playground
 * environment and asserts the exact status code, the exact response body and
 * the document that ends up being stored. Nothing here imports application
 * code: the expected behaviour is written out in full, so any change in
 * responses, status codes or stored fields fails a test.
 *
 * See e2e/README.md for configuration.
 */

import { beforeAll, describe, expect, test } from "bun:test";
// Process management only. The API contract below is asserted purely over
// HTTP, without importing anything from the package under test.
import { ensureServerRunning } from "../utils/dev-server";
import { SKIP_E2E } from "../utils/skip-e2e";
import {
  BARE_RECIPIENT,
  COMPANY_ID,
  HOST,
  EMAIL_TO,
  EMAIL_TO_2,
  RECIPIENT,
  SEND_DOCUMENT_PATH,
  SEND_PATH_V1,
  SIMULATED_PEPPOL_FAILURE,
  UNREACHABLE_RECIPIENT,
  apiIsAnswering,
  assertPlaygroundTeam,
  getCompany,
  getDocument,
  normaliseRecipient,
  requireConfig,
  sendDocument,
  type ApiResponse,
} from "./helpers";
import {
  CUSTOM_PROCESS_ID,
  DOCUMENT_VARIANTS,
  DOC_TYPE_ID,
  PROCESS_ID,
  creditNoteDocument,
  frenchInvoiceDocument,
  invalidInvoiceXmlDocument,
  invoiceDocument,
  invoiceXmlDocument,
  messageLevelResponseDocument,
  multiVatInvoiceDocument,
  selfBillingInvoiceDocument,
  UNKNOWN_DOC_TYPE_ID,
  type DocumentVariant,
} from "./documents";

const TIMEOUT = 120_000;

// Everything here needs a running server, so the whole suite steps aside when
// only the offline tests are wanted. See test/utils/skip-e2e.ts.
const e2eDescribe = describe.skipIf(SKIP_E2E);

// Exact messages the API is expected to return.
const ERROR = {
  billingOnly:
    "Only billing document types (invoice, creditNote, selfBillingInvoice, selfBillingCreditNote) are supported when recipient is null.",
  recipientOrEmail:
    "Either recipient (for Peppol) or email.to (for email delivery) must be provided.",
  pdfMessageLevelResponse:
    "PDF generation is not supported for messageLevelResponse.",
  pdfXml: "PDF generation is not supported for raw XML documents.",
  peppolFailed: `Failed to send document over Peppol network. ${SIMULATED_PEPPOL_FAILURE}`,
  peppolAndEmailFailed: `Failed to send document over Peppol network and email. ${SIMULATED_PEPPOL_FAILURE} `,
  doctypeNotDetected:
    "Document type could not be detected automatically from your XML document. Please provide the doctypeId manually.",
  processIdNotDetected:
    "Failed to detect process id. Please provide the processId manually.",
  processIdNotSupported: "Process identifier is not supported for invoice.",
  validationFailed:
    "Document validation failed. Please ensure your document complies with all requirements (e.g. EN16931, PEPPOL BIS 3.0, etc.).",
  unauthorized: "Unauthorized",
  companyNotFound: "Company not found",
} as const;

type RecipientOption = {
  value: string | null;
  /** The receiverId the API is expected to store. */
  receiverId: string | null;
  /** Whether the playground simulator accepts the address. */
  reachable: boolean;
};

const RECIPIENTS: Record<string, RecipientOption> = {
  address: {
    value: RECIPIENT,
    receiverId: normaliseRecipient(RECIPIENT),
    reachable: true,
  },
  bareNumber: {
    value: BARE_RECIPIENT,
    receiverId: normaliseRecipient(BARE_RECIPIENT),
    reachable: true,
  },
  unreachable: {
    value: UNREACHABLE_RECIPIENT,
    receiverId: UNREACHABLE_RECIPIENT,
    reachable: false,
  },
  null: { value: null, receiverId: null, reachable: false },
};

type EmailOption = {
  when?: "always" | "on_peppol_failure";
  to: string[];
  subject?: string;
  htmlBody?: string;
};

const EMAIL_OPTIONS: Record<string, EmailOption | undefined> = {
  none: undefined,
  // `when` defaults to on_peppol_failure.
  default: { to: [EMAIL_TO] },
  always: { to: [EMAIL_TO], when: "always" },
  onFailure: {
    to: [EMAIL_TO, EMAIL_TO_2],
    when: "on_peppol_failure",
    subject: "E2E test document",
    htmlBody: "<p>End-to-end test document, do not process.</p>",
  },
};

type PdfOption = { enabled: boolean; filename?: string };

const PDF_FILENAME = "e2e-custom-name.pdf";

const PDF_OPTIONS: Record<string, PdfOption | undefined> = {
  none: undefined,
  disabled: { enabled: false },
  enabled: { enabled: true },
  named: { enabled: true, filename: PDF_FILENAME },
};

type Combination = {
  variant: DocumentVariant;
  recipient: RecipientOption;
  email?: EmailOption;
  pdf?: PdfOption;
};

type Expected =
  | { kind: "failure"; status: number; message: string }
  | {
      kind: "success";
      sentOverPeppol: boolean;
      sentOverEmail: boolean;
      emailRecipients: string[];
      additionalPeppolFailureContext?: string;
    };

/**
 * The complete behaviour contract of the endpoint, in the order the API
 * applies it.
 */
function expectedOutcome(combination: Combination): Expected {
  const { variant, recipient, email, pdf } = combination;
  const emailRecipients = email?.to ?? [];
  const pdfEnabled = pdf?.enabled === true;

  if (recipient.value === null) {
    if (!variant.isBillingType) {
      return { kind: "failure", status: 400, message: ERROR.billingOnly };
    }
    if (emailRecipients.length === 0) {
      return { kind: "failure", status: 400, message: ERROR.recipientOrEmail };
    }
  }

  if (pdfEnabled && variant.documentType === "messageLevelResponse") {
    return {
      kind: "failure",
      status: 400,
      message: ERROR.pdfMessageLevelResponse,
    };
  }
  if (pdfEnabled && variant.documentType === "xml") {
    return { kind: "failure", status: 400, message: ERROR.pdfXml };
  }

  // Peppol is not attempted at all when there is no recipient, so email is
  // always sent regardless of `when`.
  if (recipient.value === null) {
    return {
      kind: "success",
      sentOverPeppol: false,
      sentOverEmail: true,
      emailRecipients,
    };
  }

  if (!recipient.reachable) {
    if (!email) {
      return { kind: "failure", status: 422, message: ERROR.peppolFailed };
    }
    if (emailRecipients.length === 0) {
      return {
        kind: "failure",
        status: 422,
        message: ERROR.peppolAndEmailFailed,
      };
    }
    // Email is sent whenever Peppol failed, whatever `when` says.
    return {
      kind: "success",
      sentOverPeppol: false,
      sentOverEmail: true,
      emailRecipients,
      additionalPeppolFailureContext: SIMULATED_PEPPOL_FAILURE,
    };
  }

  const emailAlways = email?.when === "always";
  return {
    kind: "success",
    sentOverPeppol: true,
    sentOverEmail: emailAlways && emailRecipients.length > 0,
    emailRecipients: emailAlways ? emailRecipients : [],
  };
}

function requestBody(combination: Combination): Record<string, unknown> {
  const { variant, recipient, email, pdf } = combination;
  const body: Record<string, unknown> = {
    recipient: recipient.value,
    documentType: variant.documentType,
    document: variant.document(),
  };
  if (variant.doctypeId) body.doctypeId = variant.doctypeId;
  if (variant.processId) body.processId = variant.processId;
  if (email) body.email = email;
  if (pdf) body.pdfGeneration = pdf;
  return body;
}

function expectFailure(
  response: ApiResponse,
  status: number,
  message: string
): void {
  expect(response.status).toBe(status);
  expect(response.body).toEqual({ success: false, errors: { root: [message] } });
}

function expectSuccess(
  response: ApiResponse,
  expected: Extract<Expected, { kind: "success" }>
): void {
  expect(response.status).toBe(200);

  const expectedBody: Record<string, unknown> = {
    success: true,
    teamId: expect.any(String),
    companyId: COMPANY_ID,
    id: expect.stringMatching(/^doc_[0-9A-HJKMNP-TV-Z]{26}$/),
    peppolMessageId: null,
    envelopeId: null,
    sentOverPeppol: expected.sentOverPeppol,
    sentOverEmail: expected.sentOverEmail,
    emailRecipients: expected.emailRecipients,
  };
  if (expected.additionalPeppolFailureContext) {
    expectedBody.additionalPeppolFailureContext =
      expected.additionalPeppolFailureContext;
  }

  expect(response.body).toEqual(expectedBody);
}

/** Verifies the document the API stored for a successful send. */
async function expectStoredDocument(
  sendResponse: ApiResponse,
  combination: Combination,
  expected: Extract<Expected, { kind: "success" }>
): Promise<void> {
  const response = await getDocument(sendResponse.body.id);
  expect(response.status).toBe(200);

  const document = response.body.document;
  expect(document).toMatchObject({
    id: sendResponse.body.id,
    teamId: sendResponse.body.teamId,
    companyId: COMPANY_ID,
    direction: "outgoing",
    receiverId: combination.recipient.receiverId,
    docTypeId: combination.variant.storedDocTypeId,
    processId: combination.variant.storedProcessId,
    type: combination.variant.storedType,
    sentOverPeppol: expected.sentOverPeppol,
    sentOverEmail: expected.sentOverEmail,
    emailRecipients: expected.emailRecipients,
    peppolMessageId: null,
    envelopeId: null,
  });
  expect(typeof document.senderId).toBe("string");

  // The XML is only built and stored when there is a Peppol recipient.
  if (combination.recipient.value === null) {
    expect(document.xml).toBeNull();
  } else {
    expect(typeof document.xml).toBe("string");
  }

  const attachments = document.parsed?.attachments ?? [];
  if (combination.pdf?.enabled) {
    expect(attachments).toHaveLength(1);
    expect(attachments[0].mimeCode).toBe("application/pdf");
    // "JVBER" is the base64 prefix of "%PDF".
    expect(attachments[0].embeddedDocument.startsWith("JVBER")).toBe(true);
    if (combination.pdf.filename) {
      expect(attachments[0].filename).toBe(combination.pdf.filename);
    }
  } else {
    expect(attachments).toHaveLength(0);
  }
}

async function runCombination(combination: Combination): Promise<void> {
  const expected = expectedOutcome(combination);
  const response = await sendDocument(requestBody(combination));

  if (expected.kind === "failure") {
    expectFailure(response, expected.status, expected.message);
    return;
  }

  expectSuccess(response, expected);
  await expectStoredDocument(response, combination, expected);
}

let company: any;

// Generous timeouts: the hook may have to boot the dev server, and hooks are
// subject to the (5 second) test timeout unless one is given explicitly.
//
// Nothing here stops the server. Bun runs the preloaded `test/setup.ts` hooks
// once around the whole run, while these hooks run around this file only, and
// the order Bun picks up test files is filesystem order. Stopping the server
// here would kill it halfway through a run that still has files left which
// talk to the API.
beforeAll(async () => {
  if (SKIP_E2E) return;
  requireConfig();
  // Waits until the company these tests send from can be looked up. The server
  // itself was already started by the preloaded setup; this is idempotent and
  // starts one only if that did not happen.
  await ensureServerRunning(HOST, apiIsAnswering);
  await assertPlaygroundTeam();

  const response = await getCompany();
  expect(response.status).toBe(200);
  expect(response.body.company?.id).toBe(COMPANY_ID);
  company = response.body.company;
}, 180_000);

e2eDescribe("send document: every parameter combination", () => {
  for (const variant of DOCUMENT_VARIANTS) {
    for (const [recipientKey, recipient] of Object.entries(RECIPIENTS)) {
      for (const [emailKey, email] of Object.entries(EMAIL_OPTIONS)) {
        for (const [pdfKey, pdf] of Object.entries(PDF_OPTIONS)) {
          // Slashes keep the name usable as a `-t` regex filter.
          test(
            `${variant.key} / recipient=${recipientKey} / email=${emailKey} / pdf=${pdfKey}`,
            () => runCombination({ variant, recipient, email, pdf }),
            TIMEOUT
          );
        }
      }
    }
  }
});

e2eDescribe("send document: authentication", () => {
  test(
    "without a token",
    async () => {
      const response = await sendDocument(
        {
          recipient: RECIPIENT,
          documentType: "invoice",
          document: invoiceDocument(),
        },
        { token: null }
      );
      expectFailure(response, 401, ERROR.unauthorized);
    },
    TIMEOUT
  );

  test(
    "with an invalid token",
    async () => {
      const response = await sendDocument(
        {
          recipient: RECIPIENT,
          documentType: "invoice",
          document: invoiceDocument(),
        },
        { token: "not-a-valid-token" }
      );
      expectFailure(response, 401, ERROR.unauthorized);
    },
    TIMEOUT
  );

  test(
    "for an unknown company",
    async () => {
      const response = await sendDocument(
        {
          recipient: RECIPIENT,
          documentType: "invoice",
          document: invoiceDocument(),
        },
        { path: "/api/peppol/c_00000000000000000000000000/send" }
      );
      expectFailure(response, 404, ERROR.companyNotFound);
    },
    TIMEOUT
  );
});

e2eDescribe("send document: route aliases", () => {
  const cases: [string, string][] = [
    ["/sendDocument", SEND_DOCUMENT_PATH],
    ["/api/v1", SEND_PATH_V1],
  ];

  for (const [name, path] of cases) {
    test(
      `${name} behaves like /send`,
      async () => {
        const response = await sendDocument(
          {
            recipient: RECIPIENT,
            documentType: "invoice",
            document: invoiceDocument(),
          },
          { path }
        );
        expectSuccess(response, {
          kind: "success",
          sentOverPeppol: true,
          sentOverEmail: false,
          emailRecipients: [],
        });
      },
      TIMEOUT
    );
  }
});

e2eDescribe("send document: request validation", () => {
  // The request schema validator answers with its own shape: an `errors` map
  // keyed by field path plus `invalidInputDetails`, and no `success` field.
  async function expectSchemaError(
    body: unknown,
    field: string,
    message?: string
  ): Promise<void> {
    const response = await sendDocument(body);
    expect(response.status).toBe(400);
    expect(response.body.success).toBeUndefined();
    expect(Array.isArray(response.body.invalidInputDetails)).toBe(true);
    expect(response.body.errors[field]).toBeDefined();
    if (message) {
      expect(response.body.errors[field]).toEqual([message]);
    }
  }

  test(
    "recipient is required",
    () =>
      expectSchemaError(
        { documentType: "invoice", document: invoiceDocument() },
        "recipient"
      ),
    TIMEOUT
  );

  test(
    "recipient must be a string or null",
    () =>
      expectSchemaError(
        { recipient: 123, documentType: "invoice", document: invoiceDocument() },
        "recipient"
      ),
    TIMEOUT
  );

  test(
    "documentType is required",
    () =>
      expectSchemaError(
        { recipient: RECIPIENT, document: invoiceDocument() },
        "documentType"
      ),
    TIMEOUT
  );

  test(
    "documentType must be a known value",
    () =>
      expectSchemaError(
        {
          recipient: RECIPIENT,
          documentType: "purchaseOrder",
          document: invoiceDocument(),
        },
        "documentType"
      ),
    TIMEOUT
  );

  test(
    "document is required",
    () =>
      expectSchemaError(
        { recipient: RECIPIENT, documentType: "invoice" },
        "document"
      ),
    TIMEOUT
  );

  test(
    "email.when must be a known value",
    () =>
      expectSchemaError(
        {
          recipient: RECIPIENT,
          documentType: "invoice",
          document: invoiceDocument(),
          email: { to: [EMAIL_TO], when: "sometimes" },
        },
        "email.when"
      ),
    TIMEOUT
  );

  test(
    "pdfGeneration.filename may not contain path separators",
    () =>
      expectSchemaError(
        {
          recipient: RECIPIENT,
          documentType: "invoice",
          document: invoiceDocument(),
          pdfGeneration: { enabled: true, filename: "../escape.pdf" },
        },
        "pdfGeneration.filename",
        "pdfGeneration.filename: Filename must not include path separators."
      ),
    TIMEOUT
  );
});

e2eDescribe("send document: document does not match the document type", () => {
  // The request schema binds `document` to the schema of the `documentType` that
  // was asked for, so a mismatched document never reaches the sending pipeline:
  // the validator refuses it and names the fields the requested type is missing.
  const cases: [string, unknown, string, string[]][] = [
    ["invoice", creditNoteDocument(), "invoice", ["document.invoiceNumber"]],
    [
      "creditNote",
      invoiceDocument(),
      "creditNote",
      ["document.creditNoteNumber"],
    ],
    [
      "selfBillingInvoice",
      invoiceDocument({ seller: undefined }),
      "selfBillingInvoice",
      ["document.seller"],
    ],
    [
      "selfBillingCreditNote",
      creditNoteDocument({ seller: undefined }),
      "selfBillingCreditNote",
      ["document.seller"],
    ],
    [
      "messageLevelResponse",
      invoiceDocument(),
      "messageLevelResponse",
      ["document.responseCode", "document.envelopeId"],
    ],
  ];

  for (const [name, document, documentType, fields] of cases) {
    test(
      `${name} rejects a mismatched document`,
      async () => {
        const response = await sendDocument({
          recipient: RECIPIENT,
          documentType,
          document,
        });

        expect(response.status).toBe(400);
        expect(response.body.success).toBeUndefined();
        expect(Array.isArray(response.body.invalidInputDetails)).toBe(true);
        for (const field of fields) {
          expect(response.body.errors[field]).toBeDefined();
        }
        // The document type itself was accepted: only the document is at fault.
        expect(
          Object.keys(response.body.errors).filter(
            (field) => !field.startsWith("document.")
          )
        ).toEqual([]);
      },
      TIMEOUT
    );
  }
});

e2eDescribe("send document: raw XML", () => {
  test(
    "rejects a document whose doctype cannot be detected",
    async () => {
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "xml",
        document: "this is not an xml document",
      });
      expectFailure(response, 400, ERROR.doctypeNotDetected);
    },
    TIMEOUT
  );

  test(
    "rejects an unrecognised doctypeId when no processId is given",
    async () => {
      // An unrecognised doctypeId leaves the type unknown, so the process id
      // cannot be derived from it either and the request is refused.
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "xml",
        document: invoiceXmlDocument(),
        doctypeId: UNKNOWN_DOC_TYPE_ID,
      });
      expectFailure(response, 400, ERROR.processIdNotDetected);
    },
    TIMEOUT
  );

  test(
    "accepts an unrecognised doctypeId when a processId is given",
    async () => {
      // Nothing validates the identifier itself: it is passed through to the
      // access point and stored as is, with the type left unknown.
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "xml",
        document: invoiceXmlDocument(),
        doctypeId: UNKNOWN_DOC_TYPE_ID,
        processId: CUSTOM_PROCESS_ID,
      });
      expect(response.status).toBe(200);

      const stored = await getDocument(response.body.id);
      expect(stored.body.document.docTypeId).toBe(UNKNOWN_DOC_TYPE_ID);
      expect(stored.body.document.processId).toBe(CUSTOM_PROCESS_ID);
      expect(stored.body.document.type).toBe("unknown");
    },
    TIMEOUT
  );

  test(
    "an explicit doctypeId decides how raw XML is stored",
    async () => {
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "xml",
        document: invoiceXmlDocument(),
        doctypeId: DOC_TYPE_ID.selfBillingInvoice,
      });
      expect(response.status).toBe(200);

      const stored = await getDocument(response.body.id);
      expect(stored.body.document.docTypeId).toBe(DOC_TYPE_ID.selfBillingInvoice);
      expect(stored.body.document.type).toBe("selfBillingInvoice");
      expect(stored.body.document.processId).toBe(PROCESS_ID.selfBilling);
    },
    TIMEOUT
  );

  test(
    "rejects a document that fails Peppol validation",
    async () => {
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "xml",
        document: invalidInvoiceXmlDocument(),
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.errors.root).toEqual([ERROR.validationFailed]);
      // The failing rules are reported alongside the generic message.
      expect(Object.keys(response.body.errors).length).toBeGreaterThan(1);
    },
    TIMEOUT
  );
});

e2eDescribe("send document: email fallback edge cases", () => {
  test(
    "an empty email.to list still counts as email delivery being configured",
    async () => {
      const response = await sendDocument({
        recipient: UNREACHABLE_RECIPIENT,
        documentType: "invoice",
        document: invoiceDocument(),
        email: { to: [] },
      });
      expectFailure(response, 422, ERROR.peppolAndEmailFailed);
    },
    TIMEOUT
  );

  test(
    "an empty email.to list does not affect a successful Peppol send",
    async () => {
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "invoice",
        document: invoiceDocument(),
        email: { to: [], when: "always" },
      });
      expectSuccess(response, {
        kind: "success",
        sentOverPeppol: true,
        sentOverEmail: false,
        emailRecipients: [],
      });
    },
    TIMEOUT
  );
});

e2eDescribe("send document: document defaults", () => {
  test(
    "an invoice without a seller uses the sending company",
    async () => {
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "invoice",
        document: invoiceDocument({ seller: undefined }),
      });
      expect(response.status).toBe(200);

      const stored = await getDocument(response.body.id);
      expect(stored.body.document.parsed.seller).toMatchObject({
        name: company.name,
        city: company.city,
        country: company.country,
        postalZone: company.postalCode,
      });
    },
    TIMEOUT
  );

  test(
    "a self billing invoice without a buyer uses the sending company",
    async () => {
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "selfBillingInvoice",
        document: selfBillingInvoiceDocument({ buyer: undefined }),
      });
      expect(response.status).toBe(200);

      const stored = await getDocument(response.body.id);
      expect(stored.body.document.parsed.buyer).toMatchObject({
        name: company.name,
        city: company.city,
        country: company.country,
        postalZone: company.postalCode,
      });
    },
    TIMEOUT
  );

  test(
    "an invoice without dates gets today plus one month",
    async () => {
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "invoice",
        document: invoiceDocument({ issueDate: undefined, dueDate: undefined }),
      });
      expect(response.status).toBe(200);

      const stored = await getDocument(response.body.id);
      const { issueDate, dueDate } = stored.body.document.parsed;
      expect(issueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const expectedDueDate = new Date(`${issueDate}T00:00:00Z`);
      expectedDueDate.setUTCMonth(expectedDueDate.getUTCMonth() + 1);
      expect(dueDate).toBe(expectedDueDate.toISOString().slice(0, 10));
    },
    TIMEOUT
  );

  test(
    "a message level response without an id gets one generated",
    async () => {
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "messageLevelResponse",
        document: messageLevelResponseDocument(),
      });
      expect(response.status).toBe(200);

      const stored = await getDocument(response.body.id);
      expect(stored.body.document.parsed.id).toEqual(expect.any(String));
      expect(stored.body.document.parsed.id.length).toBeGreaterThan(0);
    },
    TIMEOUT
  );
});

// The fixtures never send totals or VAT, so the API has to work them out and
// write them into the XML. These read them back from the stored document,
// which is parsed from the XML that was actually transmitted.
e2eDescribe("send document: calculated totals", () => {
  test(
    "an invoice without totals gets them calculated from its lines",
    async () => {
      // One line: 2 x 50.00 = 100.00 excluding VAT, 21% of that is 21.00.
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "invoice",
        document: invoiceDocument(),
      });
      expect(response.status).toBe(200);

      const stored = await getDocument(response.body.id);
      const parsed = stored.body.document.parsed;

      expect(parsed.totals).toEqual({
        linesAmount: "100.00",
        discountAmount: null,
        surchargeAmount: null,
        taxExclusiveAmount: "100.00",
        taxInclusiveAmount: "121.00",
        payableAmount: "121.00",
        paidAmount: "0.00",
      });
      expect(parsed.vat).toEqual({
        totalVatAmount: "21.00",
        subtotals: [
          {
            category: "S",
            percentage: "21.00",
            taxableAmount: "100.00",
            vatAmount: "21.00",
            exemptionReason: null,
            exemptionReasonCode: null,
          },
        ],
      });
      // The line total is the one the API worked out, not one we sent.
      expect(parsed.lines[0].netAmount).toBe("100.00");
    },
    TIMEOUT
  );

  test(
    "VAT is subtotalled per rate",
    async () => {
      // 2 x 50.00 at 21% is 21.00 VAT, 1 x 30.00 at 6% is 1.80, so the
      // invoice is 130.00 excluding VAT and 152.80 including it.
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "invoice",
        document: multiVatInvoiceDocument(),
      });
      expect(response.status).toBe(200);

      const stored = await getDocument(response.body.id);
      const parsed = stored.body.document.parsed;

      expect(parsed.totals).toMatchObject({
        linesAmount: "130.00",
        taxExclusiveAmount: "130.00",
        taxInclusiveAmount: "152.80",
        payableAmount: "152.80",
      });
      expect(parsed.vat.totalVatAmount).toBe("22.80");
      expect(parsed.vat.subtotals).toEqual([
        {
          category: "S",
          percentage: "21.00",
          taxableAmount: "100.00",
          vatAmount: "21.00",
          exemptionReason: null,
          exemptionReasonCode: null,
        },
        {
          category: "S",
          percentage: "6.00",
          taxableAmount: "30.00",
          vatAmount: "1.80",
          exemptionReason: null,
          exemptionReasonCode: null,
        },
      ]);
      expect(parsed.lines.map((line: any) => line.netAmount)).toEqual([
        "100.00",
        "30.00",
      ]);
    },
    TIMEOUT
  );

  test(
    "the document that was sent survives the round trip to XML",
    async () => {
      const document = invoiceDocument();
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "invoice",
        document,
      });
      expect(response.status).toBe(200);

      const stored = await getDocument(response.body.id);
      const parsed = stored.body.document.parsed;

      expect(parsed).toMatchObject({
        invoiceNumber: document.invoiceNumber,
        issueDate: document.issueDate,
        dueDate: document.dueDate,
        currency: document.currency,
        note: document.note,
        buyerReference: document.buyerReference,
        paymentTerms: { note: "Net 30" },
      });
      expect(parsed.paymentMeans).toMatchObject([
        {
          name: "Test bank",
          paymentMethod: "credit_transfer",
          reference: "E2E-PAYMENT",
          iban: "BE68539007547034",
        },
      ]);
      expect(parsed.lines).toMatchObject([
        {
          id: "1",
          name: "E2E test line",
          description: "End-to-end test line, do not process",
          quantity: "2",
          unitCode: "C62",
          netPriceAmount: "50.00",
          vat: { category: "S", percentage: "21.00" },
        },
      ]);
      expect(parsed.seller).toMatchObject({
        name: "Recommand E2E Seller",
        city: "Brussels",
        postalZone: "1000",
        country: "BE",
      });
      expect(parsed.buyer).toMatchObject({
        name: "Recommand E2E Buyer",
        city: "Antwerp",
        postalZone: "2000",
        country: "BE",
      });
    },
    TIMEOUT
  );

  test(
    "a generated PDF is named after the invoice",
    async () => {
      const document = invoiceDocument();
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "invoice",
        document,
        pdfGeneration: { enabled: true },
      });
      expect(response.status).toBe(200);

      const stored = await getDocument(response.body.id);
      const attachment = stored.body.document.parsed.attachments[0];
      const filename = `invoice-${document.invoiceNumber}.pdf`;

      expect(attachment.filename).toBe(filename);
      expect(attachment.id).toBe(filename);
      // A rendered invoice, not an empty or error page.
      expect(attachment.embeddedDocument.length).toBeGreaterThan(10_000);
    },
    TIMEOUT
  );
});

// The other side of the same contract: what the API does with totals and VAT
// that were supplied. They are taken at face value, so a document whose totals
// contradict its lines is rejected by validation rather than quietly corrected.
e2eDescribe("send document: provided totals", () => {
  const VAT = {
    totalVatAmount: "21.00",
    subtotals: [
      {
        category: "S",
        percentage: "21.00",
        taxableAmount: "100.00",
        vatAmount: "21.00",
      },
    ],
  };

  test(
    "totals and VAT that are provided are used as given",
    async () => {
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "invoice",
        document: invoiceDocument({
          totals: {
            linesAmount: "100.00",
            taxExclusiveAmount: "100.00",
            taxInclusiveAmount: "121.00",
            payableAmount: "121.00",
          },
          vat: VAT,
        }),
      });
      expect(response.status).toBe(200);

      const stored = await getDocument(response.body.id);
      const parsed = stored.body.document.parsed;

      expect(parsed.totals).toEqual({
        linesAmount: "100.00",
        discountAmount: null,
        surchargeAmount: null,
        taxExclusiveAmount: "100.00",
        taxInclusiveAmount: "121.00",
        payableAmount: "121.00",
        paidAmount: "0.00",
      });
      expect(parsed.vat).toEqual({
        totalVatAmount: "21.00",
        subtotals: [
          { ...VAT.subtotals[0], exemptionReason: null, exemptionReasonCode: null },
        ],
      });
    },
    TIMEOUT
  );

  test(
    "a prepayment is subtracted when the payable amount is given with it",
    async () => {
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "invoice",
        document: invoiceDocument({
          totals: {
            taxExclusiveAmount: "100.00",
            taxInclusiveAmount: "121.00",
            payableAmount: "100.00",
            paidAmount: "21.00",
          },
        }),
      });
      expect(response.status).toBe(200);

      const stored = await getDocument(response.body.id);
      expect(stored.body.document.parsed.totals).toMatchObject({
        taxInclusiveAmount: "121.00",
        paidAmount: "21.00",
        payableAmount: "100.00",
      });
    },
    TIMEOUT
  );

  test(
    "a prepayment on its own leaves the payable amount at the full total",
    async () => {
      // Current behaviour, and it looks wrong: paying 21.00 of a 121.00
      // invoice still asks the recipient for 121.00. The difference is
      // absorbed into a 21.00 PayableRoundingAmount, which is what keeps the
      // document passing BR-CO-16. Provide payableAmount as well to get a
      // sensible document, as the test above does.
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "invoice",
        document: invoiceDocument({
          totals: {
            taxExclusiveAmount: "100.00",
            taxInclusiveAmount: "121.00",
            paidAmount: "21.00",
          },
        }),
      });
      expect(response.status).toBe(200);

      const stored = await getDocument(response.body.id);
      expect(stored.body.document.parsed.totals).toMatchObject({
        paidAmount: "21.00",
        payableAmount: "121.00",
      });
      expect(stored.body.document.xml).toContain(
        '<cbc:PayableRoundingAmount currencyID="EUR">21.00</cbc:PayableRoundingAmount>'
      );
    },
    TIMEOUT
  );

  test(
    "totals that contradict the lines are rejected",
    async () => {
      // The lines add up to 100.00, so the document fails validation instead
      // of having its totals recalculated.
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "invoice",
        document: invoiceDocument({
          totals: {
            taxExclusiveAmount: "999.00",
            taxInclusiveAmount: "1208.79",
          },
        }),
      });

      expect(response.status).toBe(400);
      expect(response.body.errors.root).toEqual([ERROR.validationFailed]);
      // BR-CO-13: total without VAT = sum of the line net amounts.
      expect(JSON.stringify(response.body.errors)).toContain("BR-CO-13");
    },
    TIMEOUT
  );

  test(
    "VAT that contradicts the lines is rejected",
    async () => {
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "invoice",
        document: invoiceDocument({
          vat: {
            totalVatAmount: "10.00",
            subtotals: [{ ...VAT.subtotals[0], vatAmount: "10.00" }],
          },
        }),
      });

      expect(response.status).toBe(400);
      expect(response.body.errors.root).toEqual([ERROR.validationFailed]);
      // BR-S-09: standard rated VAT = taxable amount x rate.
      expect(JSON.stringify(response.body.errors)).toContain("BR-S-09");
    },
    TIMEOUT
  );
});

// Unlike raw XML, where both identifiers only describe the transmission, here
// they decide what gets generated: the doctypeId picks the syntax the document
// is written in and the processId becomes its profile identifier. A processId
// the chosen doctypeId does not support is therefore refused outright.
e2eDescribe("send document: doctypeId and processId on JSON documents", () => {
  test(
    "rejects a processId the document type does not support",
    async () => {
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "invoice",
        document: invoiceDocument(),
        processId: CUSTOM_PROCESS_ID,
      });
      expectFailure(response, 400, ERROR.processIdNotSupported);
    },
    TIMEOUT
  );

  test(
    "accepts a processId the document type does support",
    async () => {
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "invoice",
        document: invoiceDocument(),
        processId: PROCESS_ID.billing,
      });
      expect(response.status).toBe(200);

      const stored = await getDocument(response.body.id);
      expect(stored.body.document.processId).toBe(PROCESS_ID.billing);
      expect(stored.body.document.docTypeId).toBe(DOC_TYPE_ID.invoice);
    },
    TIMEOUT
  );

  test(
    "an explicit doctypeId decides which syntax is generated",
    async () => {
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "invoice",
        document: invoiceDocument(),
        doctypeId: DOC_TYPE_ID.ciiInvoice,
      });
      expect(response.status).toBe(200);

      const stored = await getDocument(response.body.id);
      expect(stored.body.document.docTypeId).toBe(DOC_TYPE_ID.ciiInvoice);
      expect(stored.body.document.processId).toBe(PROCESS_ID.billing);
    },
    TIMEOUT
  );

  test(
    "a processId is checked against the doctypeId that was given, not the default",
    async () => {
      // The default UBL BIS 3 doctype for an invoice carries the French
      // regulated process, and so do the two France CII doctypes — but the
      // plain EN 16931 CII D22B one asked for here carries billing:01 alone,
      // so the same processId is refused against it.
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "invoice",
        document: invoiceDocument(),
        doctypeId: DOC_TYPE_ID.ciiInvoice,
        processId: PROCESS_ID.franceRegulated,
      });
      expectFailure(response, 400, ERROR.processIdNotSupported);
    },
    TIMEOUT
  );

  test(
    "accepts the French regulated process on the French CII doctype",
    async () => {
      // The same processId the plain CII doctype refuses above: this one lists
      // it, so the document is generated as a French CIUS CII invoice and
      // travels over the regulated process.
      const response = await sendDocument({
        recipient: RECIPIENT,
        documentType: "invoice",
        document: frenchInvoiceDocument(),
        doctypeId: DOC_TYPE_ID.franceCiusCiiInvoice,
        processId: PROCESS_ID.franceRegulated,
      });
      expect(response.status).toBe(200);

      const stored = await getDocument(response.body.id);
      expect(stored.body.document.docTypeId).toBe(
        DOC_TYPE_ID.franceCiusCiiInvoice
      );
      expect(stored.body.document.processId).toBe(PROCESS_ID.franceRegulated);
      expect(stored.body.document.type).toBe("invoice");
    },
    TIMEOUT
  );
});
