import { describe, expect, it } from "bun:test";
import type { SendDocument } from "../utils/parsing/send-document";
import type { Party } from "../utils/parsing/invoice/schemas";
import {
  applyCustomerParty,
  setDocumentField,
  updateFormDocument,
  type Updater,
} from "../components/send-document/document-updates";

// The send-document form keeps one copy of the document and changes it with
// updaters. These tests apply updates the way React applies queued state
// updates: in order, each to the result of the previous one. Several updates
// are often queued from the same render, for example a keystroke and a field
// filled in by a request that has just returned. None of them may undo
// another.

function formState(initial: Partial<SendDocument>) {
  let state = initial;
  return {
    get: () => state,
    dispatch: (update: Updater<Partial<SendDocument>>) => {
      state = update(state);
    },
  };
}

const acme: Party = {
  name: "Acme",
  street: "Main Street 1",
  street2: null,
  city: "Brussels",
  postalZone: "1000",
  country: "BE",
  vatNumber: "BE0123456749",
  enterpriseNumber: null,
  email: null,
  phone: null,
};

describe("send-document updates", () => {
  it("keeps every keystroke when other updates land in between", () => {
    const form = formState({
      documentType: "invoice" as any,
      document: { invoiceNumber: "", lines: [], buyer: { ...acme, name: "" } } as any,
    });
    const typed = "A buyer name longer than thirty-two characters";

    for (let i = 0; i < typed.length; i++) {
      // The party form builds the party from what it rendered.
      const rendered = form.get().document as any;
      const party = { ...rendered.buyer, name: typed.slice(0, i + 1) };
      // A request started earlier (document number, own company details)
      // returns between the render and the keystroke being applied.
      form.dispatch(
        updateFormDocument(setDocumentField("invoiceNumber", `INV-${i}`))
      );
      form.dispatch(updateFormDocument(setDocumentField("buyer", party)));
    }

    const document = form.get().document as any;
    expect(document.buyer.name).toBe(typed);
    expect(document.invoiceNumber).toBe(`INV-${typed.length - 1}`);
  });

  it("keeps a counterparty edit queued in the same render as a document edit", () => {
    const form = formState({
      recipient: "",
      document: { invoiceNumber: "", lines: [] } as any,
    });

    form.dispatch(updateFormDocument(setDocumentField("buyer", acme)));
    form.dispatch(updateFormDocument(setDocumentField("seller", { ...acme, name: "Own company" })));
    form.dispatch((prev) => ({ ...prev, recipient: "0208:0123456749" }));
    form.dispatch(updateFormDocument(setDocumentField("invoiceNumber", "INV-1")));

    expect(form.get() as any).toEqual({
      recipient: "0208:0123456749",
      document: {
        invoiceNumber: "INV-1",
        lines: [],
        buyer: acme,
        seller: { ...acme, name: "Own company" },
      },
    });
  });

  it("starts from an empty document when the form holds none", () => {
    const update = updateFormDocument(setDocumentField("invoiceNumber", "INV-1"));
    expect(update({}).document as any).toEqual({ invoiceNumber: "INV-1" });
  });

  it("leaves a raw XML document alone", () => {
    const update = updateFormDocument(setDocumentField("invoiceNumber", "INV-1"));
    const xml: Partial<SendDocument> = { documentType: "xml" as any, document: "<Invoice/>" as any };
    expect(update(xml)).toBe(xml);
  });

  describe("applyCustomerParty", () => {
    it("fills in the selected customer as the counterparty", () => {
      expect(applyCustomerParty("buyer", acme)({ lines: [] })).toEqual({
        lines: [],
        buyer: acme,
      });
      expect(applyCustomerParty("seller", acme)({ lines: [] })).toEqual({
        lines: [],
        seller: acme,
      });
    });

    it("leaves edits to the same customer in place", () => {
      const edited = { lines: [], buyer: { ...acme, email: "billing@example.com" } };
      expect(applyCustomerParty("buyer", acme)(edited)).toBe(edited);
    });

    it("replaces a different counterparty", () => {
      const other = { lines: [], buyer: { ...acme, name: "Other" } };
      expect(applyCustomerParty("buyer", acme)(other).buyer).toEqual(acme);
    });
  });
});
