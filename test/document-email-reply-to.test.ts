import { describe, expect, it } from "bun:test";
import { documentEmailReplyTo } from "../data/email/send-email";
import { getDocumentType } from "../utils/type-repository/document-types";

describe("where a reply to a document email goes", () => {
  it("goes to the address the sender asked for", () => {
    expect(documentEmailReplyTo("billing@example.com", "seller@example.com")).toBe("billing@example.com");
  });

  it("goes to the issuer's address from the document when none was asked for", () => {
    expect(documentEmailReplyTo(undefined, "seller@example.com")).toBe("seller@example.com");
  });

  it("is left out when the document has no usable address", () => {
    expect(documentEmailReplyTo(undefined, undefined)).toBeUndefined();
    // The mail service would refuse the whole message over it.
    expect(documentEmailReplyTo(undefined, "accounts at example dot com")).toBeUndefined();
  });

  it("takes the issuer's address from the seller, or from the buyer for self-billing", () => {
    const parties = {
      seller: { name: "Seller", email: " seller@example.com " },
      buyer: { name: "Buyer", email: "buyer@example.com" },
    };
    const senderEmail = (type: "invoice" | "creditNote" | "selfBillingInvoice" | "selfBillingCreditNote") =>
      getDocumentType(type)!.email!.extractDocumentDetails(parties as never).senderEmail;

    expect(senderEmail("invoice")).toBe("seller@example.com");
    expect(senderEmail("creditNote")).toBe("seller@example.com");
    expect(senderEmail("selfBillingInvoice")).toBe("buyer@example.com");
    expect(senderEmail("selfBillingCreditNote")).toBe("buyer@example.com");
  });
});
