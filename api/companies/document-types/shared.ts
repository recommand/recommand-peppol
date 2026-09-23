import z from "zod";
import "zod-openapi/extend";

export const companyDocumentTypeResponse = z.object({
    id: z.string().openapi({
        description: "The ID of the document type record. Use it with the get, update and delete document type endpoints.",
        example: "cdt_01JQZ8X0M4T7RB6K9V2NDHW3PA",
    }),
    companyId: z.string().openapi({
        description: "The ID of the company this document type belongs to.",
        example: "c_01JQZ8X0M4T7RB6K9V2NDHW3PA",
    }),
    docTypeId: z.string().openapi({
        description: "The full Peppol document type identifier the company accepts. It names the syntax and the customization a sender has to follow.",
        example: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1",
    }),
    processId: z.string().openapi({
        description: "The Peppol process identifier the document type is accepted under. It names the business process the document type is used in.",
        example: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
    }),
    createdAt: z.string().datetime().openapi({
        description: "When the document type was added to the company.",
    }),
    updatedAt: z.string().datetime().openapi({
        description: "When the document type was last changed.",
    }),
});
