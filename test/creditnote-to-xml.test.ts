import { describe, it, expect } from "bun:test";
import { creditNoteToUBL } from "../utils/parsing/creditnote/peppol-ubl-bis3/to-xml";
import { creditNoteToCII } from "../utils/parsing/creditnote/cii-d22b/to-xml";
import type { CreditNote } from "../utils/parsing/creditnote/schemas";
import { parseCreditNoteFromXML } from "@peppol/utils/parsing/creditnote/peppol-ubl-bis3/from-xml";
import { parseCreditNoteFromCII } from "@peppol/utils/parsing/creditnote/cii-d22b/from-xml";
import { sendDocumentViaAPI, validateXml } from "./utils/utils";
import { XMLParser } from "fast-xml-parser";
import { FACTURX_FRANCE_CREDIT_NOTE_D22B_DOCUMENT_TYPE_INFO } from "@peppol/utils/document-types";
import { resolveOutgoingDocumentXmlHandler } from "@peppol/utils/outgoing-document-payload";

function checkUBLCreditNoteXML(xml: string, creditNote: CreditNote) {
    expect(xml).toBeDefined();
    expect(typeof xml).toBe("string");
    expect(xml.length).toBeGreaterThan(0);

    expect(xml).toContain('<CreditNote');
    expect(xml).toContain('xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"');

    expect(xml).toContain(String(creditNote.creditNoteNumber));
    expect(xml).toContain(String(creditNote.issueDate));

    if (creditNote.currency) {
        expect(xml).toContain(String(creditNote.currency));
    }
    expect(xml).toContain(String(creditNote.seller.name));
    expect(xml).toContain(String(creditNote.buyer.name));
}

function checkCIICreditNoteXML(xml: string, creditNote: CreditNote) {
    expect(xml).toBeDefined();
    expect(typeof xml).toBe("string");
    expect(xml.length).toBeGreaterThan(0);

    expect(xml).toContain("<CrossIndustryInvoice");
    expect(xml).toContain(
        'xmlns="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"'
    );

    expect(xml).toContain(String(creditNote.creditNoteNumber));
    expect(xml).toContain(String(creditNote.issueDate).replaceAll("-", ""));

    if (creditNote.currency) {
        expect(xml).toContain(String(creditNote.currency));
    }
    expect(xml).toContain(String(creditNote.seller.name));
    expect(xml).toContain(String(creditNote.buyer.name));
}

async function checkCreditNoteXML({
    creditNote,
    senderAddress,
    recipientAddress,
    testName = "credit note",
    isDocumentValidationEnforced = false,
}: {
    creditNote: CreditNote;
    senderAddress: string;
    recipientAddress: string;
    testName?: string;
    isDocumentValidationEnforced?: boolean;
}) {
    const ublXml = creditNoteToUBL({
        creditNote,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced,
    });
    const ciiXml = creditNoteToCII({
        creditNote,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced,
    });
    const facturXResolution = resolveOutgoingDocumentXmlHandler(
        FACTURX_FRANCE_CREDIT_NOTE_D22B_DOCUMENT_TYPE_INFO.docTypeId,
        "creditNote"
    );
    if (!facturXResolution.ok) {
        throw new Error(facturXResolution.message);
    }
    const facturXXml = facturXResolution.resolution.handler.toXml({
        document: creditNote,
        senderAddress,
        recipientAddress,
        isDocumentValidationEnforced,
    });

    checkUBLCreditNoteXML(ublXml, creditNote);
    checkCIICreditNoteXML(ciiXml, creditNote);
    checkCIICreditNoteXML(facturXXml, creditNote);
    expect(facturXXml).toContain("<ram:ID>urn:cen.eu:en16931:2017</ram:ID>");

    await Promise.all([
        validateXml(ublXml, `${testName} UBL`),
        validateXml(ciiXml, `${testName} CII D22B`),
        validateXml(facturXXml, `${testName} Factur-X CII D22B`),
    ]);

    const parsedUbl = parseCreditNoteFromXML(ublXml);
    const parsedCii = parseCreditNoteFromCII(ciiXml);
    const parsedFacturX = parseCreditNoteFromCII(facturXXml);

    expect(parsedCii).toEqual(parsedUbl);
    expect(parsedFacturX).toEqual(parsedUbl);

    return { ublXml, ciiXml, facturXXml, parsedCreditNote: parsedUbl };
}

describe("creditNoteToUBL", () => {
    it("should convert credit note to XML", async () => {
        const creditNote: CreditNote = {
            creditNoteNumber: "CN-001",
            issueDate: "2025-10-29",
            currency: "EUR",
            note: "Credit note",
            buyerReference: "REFERENCE",
            purchaseOrderReference: "PurchaseOrderReference",
            invoiceReferences: [
                {
                    id: "INV-001",
                    issueDate: "2025-10-01",
                },
            ],
            seller: {
                name: "BEDRIJF",
                street: "STRAAT",
                city: "STAD",
                postalZone: "1234",
                country: "BE",
                vatNumber: "BE1234567894",
                street2: null,
            },
            buyer: {
                name: "KLANT",
                street: "STRAAT",
                city: "STAD",
                postalZone: "1234",
                country: "BE",
                vatNumber: "BE1234567894",
                street2: null,
            },
            lines: [
                {
                    name: "Credit item",
                    quantity: "1",
                    unitCode: "C62",
                    netPriceAmount: "100",
                    netAmount: null,
                    vat: {
                        category: "S",
                        percentage: "21.00",
                    },
                    buyersId: null,
                    sellersId: "CREDIT",
                    standardId: null,
                    description: null,
                    originCountry: null,
                },
            ],
            surcharges: [
                {
                    reasonCode: "FC",
                    reason: "Freight services",
                    amount: "10.00",
                    vat: {
                        category: "S",
                        percentage: "6.00",
                    },
                },
            ],
            discounts: [
                {
                    reasonCode: "95",
                    reason: "Discount",
                    amount: "10.00",
                    vat: {
                        category: "S",
                        percentage: "6.00",
                    },
                },
            ],
            paymentMeans: [
                {
                    iban: "BE1234567890",
                    reference: "REFERENCE",
                    paymentMethod: "credit_transfer",
                },
            ],
            paymentTerms: {
                note: "Payment within 30 days",
            },
            vat: null,
            delivery: null,
            totals: {
                paidAmount: "0.00",
                linesAmount: null,
                payableAmount: "121.00",
                discountAmount: null,
                surchargeAmount: null,
                taxExclusiveAmount: "100.00",
                taxInclusiveAmount: "121.00",
            },
        };

        const senderAddress = "0208:0428643097";
        const recipientAddress = "0208:0598726857";

        const { parsedCreditNote: parsed } = await checkCreditNoteXML({
            creditNote,
            senderAddress,
            recipientAddress,
            testName: "credit note",
        });

        expect(parsed.creditNoteNumber).toBe(creditNote.creditNoteNumber);
        expect(parsed.issueDate).toBe(creditNote.issueDate);
        expect(parsed.currency).toBe(creditNote.currency);
        expect(parsed.seller.name).toBe(creditNote.seller.name);
        expect(parsed.buyer.name).toBe(creditNote.buyer.name);
        expect(parsed.lines.length).toBe(creditNote.lines.length);
        expect(parsed.totals?.discountAmount).toEqual("10.00");
        expect(parsed.totals?.surchargeAmount).toEqual("10.00");
        expect(parsed.totals?.taxExclusiveAmount).toEqual("100.00");
        expect(parsed.totals?.taxInclusiveAmount).toEqual("121.00");
        expect(parsed.totals?.payableAmount).toEqual("121.00");
        expect(parsed.vat?.totalVatAmount).toEqual("21.00");
        expect(parsed.vat?.subtotals.length).toBe(2);

        await sendDocumentViaAPI(creditNote, "creditNote", recipientAddress);
    });

    function createBaseCreditNote(overrides: Partial<CreditNote>): CreditNote {
        return {
            creditNoteNumber: "TEST-CN-001",
            issueDate: "2025-01-01",
            currency: "EUR",
            seller: {
                name: "Test Seller",
                street: "Seller Street 1",
                city: "Seller City",
                postalZone: "1000",
                country: "BE",
                vatNumber: "BE1234567894",
                street2: null,
            },
            buyer: {
                name: "Test Buyer",
                street: "Buyer Street 1",
                city: "Buyer City",
                postalZone: "2000",
                country: "BE",
                vatNumber: "BE9876543210",
                street2: null,
            },
            lines: [],
            invoiceReferences: [],
            paymentTerms: {
                note: "Payment within 30 days",
            },
            ...overrides,
        };
    }

    describe("address mapping", () => {
        it("should map senderAddress to supplier and recipientAddress to customer", async () => {
            const creditNote = createBaseCreditNote({
                lines: [
                    {
                        name: "Item 1",
                        quantity: "1",
                        unitCode: "C62",
                        netPriceAmount: "100.00",
                        netAmount: null,
                        vat: { category: "S", percentage: "21.00" },
                        buyersId: null,
                        sellersId: null,
                        standardId: null,
                        description: null,
                        originCountry: null,
                    },
                ],
            });

            const senderAddress = "0208:0428643097";
            const recipientAddress = "0208:0598726857";
            const { ublXml: xml, parsedCreditNote } = await checkCreditNoteXML({
                creditNote,
                senderAddress,
                recipientAddress,
                testName: "address mapping",
            });

            const parser = new XMLParser({
                ignoreAttributes: false,
                attributeNamePrefix: "@_",
                removeNSPrefix: true,
                parseAttributeValue: false,
                parseTagValue: false,
            });
            const parsed = parser.parse(xml);

            const supplierEndpointId = parsed.CreditNote.AccountingSupplierParty.Party.EndpointID;
            const customerEndpointId = parsed.CreditNote.AccountingCustomerParty.Party.EndpointID;

            expect(`${supplierEndpointId["@_schemeID"]}:${supplierEndpointId["#text"]}`).toBe(senderAddress);
            expect(`${customerEndpointId["@_schemeID"]}:${customerEndpointId["#text"]}`).toBe(recipientAddress);

            expect(parsedCreditNote.seller.name).toBe(creditNote.seller.name);
            expect(parsedCreditNote.buyer.name).toBe(creditNote.buyer.name);

            await sendDocumentViaAPI(creditNote, "creditNote", recipientAddress);
        });
    });

    describe("enterprise number", () => {
        it("should include enterprise number in seller and buyer when provided", async () => {
            const creditNote = createBaseCreditNote({
                seller: {
                    name: "Test Seller",
                    street: "Seller Street 1",
                    city: "Seller City",
                    postalZone: "1000",
                    country: "BE",
                    vatNumber: "BE1234567894",
                    enterpriseNumber: "1234567894",
                    street2: null,
                },
                buyer: {
                    name: "Test Buyer",
                    street: "Buyer Street 1",
                    city: "Buyer City",
                    postalZone: "2000",
                    country: "BE",
                    vatNumber: "BE9876543210",
                    enterpriseNumber: "9876543210",
                    street2: null,
                },
                lines: [
                    {
                        name: "Item 1",
                        quantity: "1",
                        unitCode: "C62",
                        netPriceAmount: "100.00",
                        netAmount: null,
                        vat: { category: "S", percentage: "21.00" },
                        buyersId: null,
                        sellersId: null,
                        standardId: null,
                        description: null,
                        originCountry: null,
                    },
                ],
            });

            const senderAddress = "0208:0428643097";
            const recipientAddress = "0208:0598726857";
            const { ublXml: xml, parsedCreditNote } = await checkCreditNoteXML({
                creditNote,
                senderAddress,
                recipientAddress,
                testName: "enterprise number",
            });

            expect(xml).toContain('<cbc:CompanyID>1234567894</cbc:CompanyID>');
            expect(xml).toContain('<cbc:CompanyID>9876543210</cbc:CompanyID>');

            const parser = new XMLParser({
                ignoreAttributes: false,
                attributeNamePrefix: "@_",
                removeNSPrefix: true,
                parseAttributeValue: false,
                parseTagValue: false,
            });
            const parsed = parser.parse(xml);
            const supplierEnterpriseNumber = parsed.CreditNote.AccountingSupplierParty.Party.PartyLegalEntity.CompanyID;
            const customerEnterpriseNumber = parsed.CreditNote.AccountingCustomerParty.Party.PartyLegalEntity.CompanyID;

            expect(supplierEnterpriseNumber).toBe("1234567894");
            expect(customerEnterpriseNumber).toBe("9876543210");

            expect(parsedCreditNote.seller.name).toBe(creditNote.seller.name);
            expect(parsedCreditNote.buyer.name).toBe(creditNote.buyer.name);

            await sendDocumentViaAPI(creditNote, "creditNote", recipientAddress);
        });

        it("should handle missing enterprise number", async () => {
            const creditNote = createBaseCreditNote({
                seller: {
                    name: "Test Seller",
                    street: "Seller Street 1",
                    city: "Seller City",
                    postalZone: "1000",
                    country: "BE",
                    vatNumber: "BE1234567894",
                    enterpriseNumber: null,
                    street2: null,
                },
                buyer: {
                    name: "Test Buyer",
                    street: "Buyer Street 1",
                    city: "Buyer City",
                    postalZone: "2000",
                    country: "BE",
                    vatNumber: "BE9876543210",
                    enterpriseNumber: null,
                    street2: null,
                },
                lines: [
                    {
                        name: "Item 1",
                        quantity: "1",
                        unitCode: "C62",
                        netPriceAmount: "100.00",
                        netAmount: null,
                        vat: { category: "S", percentage: "21.00" },
                        buyersId: null,
                        sellersId: null,
                        standardId: null,
                        description: null,
                        originCountry: null,
                    },
                ],
            });

            const senderAddress = "0208:0428643097";
            const recipientAddress = "0208:0598726857";
            await checkCreditNoteXML({
                creditNote,
                senderAddress,
                recipientAddress,
                testName: "missing enterprise number",
            });

            await sendDocumentViaAPI(creditNote, "creditNote", recipientAddress);
        });
    });

    describe("line-level discounts and surcharges", () => {
        it("should preserve line discounts and surcharges in round-trip conversion", async () => {
            const creditNote = createBaseCreditNote({
                lines: [
                    {
                        name: "Item 1",
                        quantity: "3.5",
                        unitCode: "C62",
                        netPriceAmount: "50.00",
                        netAmount: null,
                        vat: { category: "S", percentage: "21.00" },
                        discounts: [
                            { amount: "10.00", reason: "Early payment discount" },
                            { amount: "5.00", reason: "Volume discount" },
                        ],
                        surcharges: [
                            { amount: "8.50", reason: "Handling fee" },
                        ],
                        buyersId: null,
                        sellersId: null,
                        standardId: null,
                        description: null,
                        originCountry: null,
                    },
                    {
                        name: "Item 2",
                        quantity: "2",
                        unitCode: "C62",
                        netPriceAmount: "75.00",
                        netAmount: null,
                        vat: { category: "S", percentage: "21.00" },
                        discounts: [
                            { amount: "12.00", reasonCode: "95" },
                        ],
                        surcharges: [
                            { amount: "5.00", reason: "Shipping" },
                            { amount: "3.00", reasonCode: "FC" },
                        ],
                        buyersId: null,
                        sellersId: null,
                        standardId: null,
                        description: null,
                        originCountry: null,
                    },
                ],
            });

            const senderAddress = "0208:0428643097";
            const recipientAddress = "0208:0598726857";
            const { parsedCreditNote: parsed } = await checkCreditNoteXML({
                creditNote,
                senderAddress,
                recipientAddress,
                testName: "line-level discounts and surcharges",
            });

            expect(parsed.lines.length).toBe(2);

            const line1 = parsed.lines[0];
            expect(line1.name).toBe("Item 1");
            expect(parseFloat(line1.quantity)).toBe(3.5);
            expect(parseFloat(line1.netPriceAmount)).toBe(50);
            expect(line1.discounts?.length).toBe(2);
            expect(line1.discounts?.[0].amount).toBe("10.00");
            expect(line1.discounts?.[0].reason).toBe("Early payment discount");
            expect(line1.discounts?.[1].amount).toBe("5.00");
            expect(line1.discounts?.[1].reason).toBe("Volume discount");
            expect(line1.surcharges?.length).toBe(1);
            expect(line1.surcharges?.[0].amount).toBe("8.50");
            expect(line1.surcharges?.[0].reason).toBe("Handling fee");

            const line2 = parsed.lines[1];
            expect(line2.name).toBe("Item 2");
            expect(parseFloat(line2.quantity)).toBe(2);
            expect(parseFloat(line2.netPriceAmount)).toBe(75);
            expect(line2.discounts?.length).toBe(1);
            expect(line2.discounts?.[0].amount).toBe("12.00");
            expect(line2.discounts?.[0].reasonCode).toBe("95");
            expect(line2.surcharges?.length).toBe(2);
            expect(line2.surcharges?.[0].amount).toBe("5.00");
            expect(line2.surcharges?.[0].reason).toBe("Shipping");
            expect(line2.surcharges?.[1].amount).toBe("3.00");
            expect(line2.surcharges?.[1].reasonCode).toBe("FC");

            expect(line1.netAmount).toBeDefined();
            expect(line2.netAmount).toBeDefined();

            await sendDocumentViaAPI(creditNote, "creditNote", recipientAddress);
        });
    });

    describe("global discounts and surcharges", () => {
        it("should preserve global discounts and surcharges in round-trip conversion", async () => {
            const creditNote = createBaseCreditNote({
                lines: [
                    {
                        name: "Item 1",
                        quantity: "1",
                        unitCode: "C62",
                        netPriceAmount: "100.00",
                        netAmount: null,
                        vat: { category: "S", percentage: "21.00" },
                        buyersId: null,
                        sellersId: null,
                        standardId: null,
                        description: null,
                        originCountry: null,
                    },
                ],
                discounts: [
                    {
                        reasonCode: "95",
                        reason: "Early payment discount",
                        amount: "10.00",
                        vat: { category: "S", percentage: "21.00" },
                    },
                    {
                        reason: "Volume discount",
                        amount: "5.00",
                        vat: { category: "S", percentage: "21.00" },
                    },
                ],
                surcharges: [
                    {
                        reasonCode: "FC",
                        reason: "Freight services",
                        amount: "8.50",
                        vat: { category: "S", percentage: "21.00" },
                    },
                    {
                        reason: "Handling fee",
                        amount: "3.00",
                        vat: { category: "S", percentage: "6.00" },
                    },
                ],
            });

            const senderAddress = "0208:0428643097";
            const recipientAddress = "0208:0598726857";
            const { parsedCreditNote: parsed } = await checkCreditNoteXML({
                creditNote,
                senderAddress,
                recipientAddress,
                testName: "global discounts and surcharges",
            });

            expect(parsed.discounts?.length).toBe(2);
            expect(parsed.discounts?.[0].amount).toBe("10.00");
            expect(parsed.discounts?.[0].reasonCode).toBe("95");
            expect(parsed.discounts?.[0].reason).toBe("Early payment discount");
            expect(parsed.discounts?.[0].vat.category).toBe("S");
            expect(parsed.discounts?.[0].vat.percentage).toBe("21.00");
            expect(parsed.discounts?.[1].amount).toBe("5.00");
            expect(parsed.discounts?.[1].reason).toBe("Volume discount");
            expect(parsed.discounts?.[1].vat.category).toBe("S");
            expect(parsed.discounts?.[1].vat.percentage).toBe("21.00");

            expect(parsed.surcharges?.length).toBe(2);
            expect(parsed.surcharges?.[0].amount).toBe("8.50");
            expect(parsed.surcharges?.[0].reasonCode).toBe("FC");
            expect(parsed.surcharges?.[0].reason).toBe("Freight services");
            expect(parsed.surcharges?.[0].vat.category).toBe("S");
            expect(parsed.surcharges?.[0].vat.percentage).toBe("21.00");
            expect(parsed.surcharges?.[1].amount).toBe("3.00");
            expect(parsed.surcharges?.[1].reason).toBe("Handling fee");
            expect(parsed.surcharges?.[1].vat.category).toBe("S");
            expect(parsed.surcharges?.[1].vat.percentage).toBe("6.00");

            await sendDocumentViaAPI(creditNote, "creditNote", recipientAddress);
        });
    });

    describe("invoice references", () => {
        it("should preserve invoice references in round-trip conversion", async () => {
            const creditNote = createBaseCreditNote({
                lines: [
                    {
                        name: "Item 1",
                        quantity: "1",
                        unitCode: "C62",
                        netPriceAmount: "100.00",
                        netAmount: null,
                        vat: { category: "S", percentage: "21.00" },
                        buyersId: null,
                        sellersId: null,
                        standardId: null,
                        description: null,
                        originCountry: null,
                    },
                ],
                invoiceReferences: [
                    {
                        id: "INV-001",
                        issueDate: "2025-01-01",
                    },
                ],
            });

            const senderAddress = "0208:0428643097";
            const recipientAddress = "0208:0598726857";
            const { parsedCreditNote: parsed } = await checkCreditNoteXML({
                creditNote,
                senderAddress,
                recipientAddress,
                testName: "invoice references",
            });

            expect(parsed.invoiceReferences.length).toBe(1);
            expect(parsed.invoiceReferences[0].id).toBe("INV-001");
            expect(parsed.invoiceReferences[0].issueDate).toBe("2025-01-01");

            await sendDocumentViaAPI(creditNote, "creditNote", recipientAddress);
        });
    });

    describe("VAT edge cases", () => {
        it("should handle multiple VAT rates including exempt category", async () => {
            const creditNote = createBaseCreditNote({
                lines: [
                    {
                        name: "Item 1 - Standard 21%",
                        quantity: "10",
                        unitCode: "C62",
                        netPriceAmount: "235.20",
                        netAmount: null,
                        vat: { category: "S", percentage: "21.00" },
                        buyersId: null,
                        sellersId: null,
                        standardId: null,
                        description: null,
                        originCountry: null,
                    },
                    {
                        name: "Item 2 - Standard 6%",
                        quantity: "2",
                        unitCode: "C62",
                        netPriceAmount: "98.00",
                        netAmount: null,
                        vat: { category: "S", percentage: "6.00" },
                        buyersId: null,
                        sellersId: null,
                        standardId: null,
                        description: null,
                        originCountry: null,
                    },
                    {
                        name: "Item 3 - Exempt",
                        quantity: "1",
                        unitCode: "C62",
                        netPriceAmount: "52.00",
                        netAmount: null,
                        vat: { category: "E", percentage: "0.00" },
                        buyersId: null,
                        sellersId: null,
                        standardId: null,
                        description: null,
                        originCountry: null,
                    },
                ],
                vat: {
                    totalVatAmount: "505.68",
                    subtotals: [
                        {
                            taxableAmount: "2352.00",
                            vatAmount: "493.92",
                            category: "S",
                            percentage: "21.00",
                        },
                        {
                            taxableAmount: "196.00",
                            vatAmount: "11.76",
                            category: "S",
                            percentage: "6.00",
                        },
                        {
                            taxableAmount: "52.00",
                            vatAmount: "0.00",
                            category: "E",
                            percentage: "0.00",
                            exemptionReason: "Exempt from tax",
                        },
                    ],
                },
            });

            const senderAddress = "0208:0428643097";
            const recipientAddress = "0208:0598726857";
            const { parsedCreditNote: parsed } = await checkCreditNoteXML({
                creditNote,
                senderAddress,
                recipientAddress,
                testName: "VAT edge cases",
            });

            expect(parsed.vat).toBeDefined();
            expect(parsed.vat?.totalVatAmount).toBe("505.68");
            expect(parsed.vat?.subtotals.length).toBe(3);

            const vat21Subtotal = parsed.vat?.subtotals.find(s => s.percentage === "21.00" && s.category === "S");
            expect(vat21Subtotal).toBeDefined();
            expect(vat21Subtotal?.taxableAmount).toBe("2352.00");
            expect(vat21Subtotal?.vatAmount).toBe("493.92");

            const vat6Subtotal = parsed.vat?.subtotals.find(s => s.percentage === "6.00" && s.category === "S");
            expect(vat6Subtotal).toBeDefined();
            expect(vat6Subtotal?.taxableAmount).toBe("196.00");
            expect(vat6Subtotal?.vatAmount).toBe("11.76");

            const vat0Subtotal = parsed.vat?.subtotals.find(s => s.percentage === "0.00" && s.category === "E");
            expect(vat0Subtotal).toBeDefined();
            expect(vat0Subtotal?.taxableAmount).toBe("52.00");
            expect(vat0Subtotal?.vatAmount).toBe("0.00");
            expect(vat0Subtotal?.exemptionReason).toBe("Exempt from tax");

            await sendDocumentViaAPI(creditNote, "creditNote", recipientAddress);
        });
    });

    describe("edge cases", () => {
        it("should handle credit note with missing optional fields", async () => {
            const creditNote = createBaseCreditNote({
                note: null,
                buyerReference: null,
                purchaseOrderReference: null,
                despatchReference: null,
                paymentMeans: null,
                delivery: null,
                discounts: null,
                surcharges: null,
                attachments: null,
                lines: [
                    {
                        name: "Item 1",
                        quantity: "1",
                        unitCode: "C62",
                        netPriceAmount: "100.00",
                        netAmount: null,
                        vat: { category: "S", percentage: "21.00" },
                        buyersId: null,
                        sellersId: null,
                        standardId: null,
                        description: null,
                        originCountry: null,
                    },
                ],
            });

            const senderAddress = "0208:0428643097";
            const recipientAddress = "0208:0598726857";
            const { parsedCreditNote: parsed } = await checkCreditNoteXML({
                creditNote,
                senderAddress,
                recipientAddress,
                testName: "missing optional fields",
            });

            expect(parsed.creditNoteNumber).toBe(creditNote.creditNoteNumber);
            expect(parsed.lines.length).toBe(1);

            await sendDocumentViaAPI(creditNote, "creditNote", recipientAddress);
        });

        it("should handle credit note with street2", async () => {
            const creditNote = createBaseCreditNote({
                seller: {
                    name: "Test Seller",
                    street: "Seller Street 1",
                    street2: "Suite 100",
                    city: "Seller City",
                    postalZone: "1000",
                    country: "BE",
                    vatNumber: "BE1234567894",
                    enterpriseNumber: null,
                },
                buyer: {
                    name: "Test Buyer",
                    street: "Buyer Street 1",
                    street2: "Floor 2",
                    city: "Buyer City",
                    postalZone: "2000",
                    country: "BE",
                    vatNumber: "BE9876543210",
                    enterpriseNumber: null,
                },
                lines: [
                    {
                        name: "Item 1",
                        quantity: "1",
                        unitCode: "C62",
                        netPriceAmount: "100.00",
                        netAmount: null,
                        vat: { category: "S", percentage: "21.00" },
                        buyersId: null,
                        sellersId: null,
                        standardId: null,
                        description: null,
                        originCountry: null,
                    },
                ],
            });

            const senderAddress = "0208:0428643097";
            const recipientAddress = "0208:0598726857";
            const { parsedCreditNote: parsed } = await checkCreditNoteXML({
                creditNote,
                senderAddress,
                recipientAddress,
                testName: "street2",
            });

            expect(parsed.seller.street2).toBe("Suite 100");
            expect(parsed.buyer.street2).toBe("Floor 2");

            await sendDocumentViaAPI(creditNote, "creditNote", recipientAddress);
        });
    });

    describe("VAT category O (Not subject to VAT)", () => {
        it("should handle credit note with VAT category O and exemption reason", async () => {
            const creditNote = createBaseCreditNote({
                seller: {
                    name: "Test Seller",
                    street: "Seller Street 1",
                    city: "Seller City",
                    postalZone: "1000",
                    country: "BE",
                    vatNumber: null,
                    enterpriseNumber: "1234567894",
                    street2: null,
                },
                buyer: {
                    name: "Test Buyer",
                    street: "Buyer Street 1",
                    city: "Buyer City",
                    postalZone: "2000",
                    country: "BE",
                    vatNumber: null,
                    enterpriseNumber: "9876543210",
                    street2: null,
                },
                lines: [
                    {
                        name: "Item not subject to VAT",
                        quantity: "1",
                        unitCode: "C62",
                        netPriceAmount: "100.00",
                        netAmount: null,
                        vat: {
                            category: "O",
                            percentage: "0.00",
                        },
                        buyersId: null,
                        sellersId: null,
                        standardId: null,
                        description: null,
                        originCountry: null,
                    },
                ],
                vat: {
                    exemptionReason: "Not subject to VAT according to local legislation",
                } as any,
                totals: {
                    paidAmount: "0.00",
                    linesAmount: null,
                    payableAmount: "100.00",
                    discountAmount: null,
                    surchargeAmount: null,
                    taxExclusiveAmount: "100.00",
                    taxInclusiveAmount: "100.00",
                },
            });

            const senderAddress = "0208:0428643097";
            const recipientAddress = "0208:0598726857";
            const { ublXml: xml, parsedCreditNote: parsed } = await checkCreditNoteXML({
                creditNote,
                senderAddress,
                recipientAddress,
                testName: "VAT category O with exemption reason",
            });

            expect(xml).toContain('cbc:ID>O</cbc:ID>');
            expect(xml).toContain("Not subject to VAT according to local legislation");
            expect(xml).toContain('<cbc:CompanyID>1234567894</cbc:CompanyID>');

            expect(parsed.lines[0].vat.category).toBe("O");
            expect(parsed.lines[0].vat.percentage).toBe("0.00");
            expect(parsed.vat?.subtotals.length).toBe(1);
            expect(parsed.vat?.subtotals[0].category).toBe("O");
            expect(parsed.vat?.subtotals[0].vatAmount).toBe("0.00");
            expect(parsed.vat?.subtotals[0].exemptionReason).toBe("Not subject to VAT according to local legislation");
            expect(parsed.totals?.taxExclusiveAmount).toBe("100.00");
            expect(parsed.totals?.taxInclusiveAmount).toBe("100.00");
            expect(parsed.totals?.payableAmount).toBe("100.00");

            await sendDocumentViaAPI(creditNote, "creditNote", recipientAddress);
        });
    });
});
