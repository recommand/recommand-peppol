import z from "zod";
import type { Company } from "@peppol/data/companies";

export const companyResponse = z.object({
    id: z.string().openapi({
        description: "The ID of the company. Use it wherever an endpoint takes a companyId.",
        example: "c_01JQZ8X0M4T7RB6K9V2NDHW3PA",
    }),
    teamId: z.string().openapi({
        description: "The ID of the team the company belongs to.",
        example: "team_01JQZ8X0M4T7RB6K9V2NDHW3PA",
    }),
    name: z.string().openapi({
        description: "The legal name of the company, as it is written on the documents it sends.",
        example: "Recommand BV",
    }),
    address: z.string().openapi({
        description: "Street name and number of the company's registered address.",
        example: "Kortrijksesteenweg 1092",
    }),
    postalCode: z.string().openapi({
        description: "Postal code of the company's registered address.",
        example: "9051",
    }),
    city: z.string().openapi({
        description: "City of the company's registered address.",
        example: "Gent",
    }),
    country: z.string().openapi({
        description: "The country the company is registered in, in ISO 3166-1 alpha-2 format.",
        example: "BE",
    }),
    enterpriseNumberScheme: z.string().nullable().openapi({
        description: "The Peppol scheme the enterprise number belongs to, for example `0208` for the Belgian enterprise number register. Null when no scheme was recorded.",
        example: "0208",
    }),
    enterpriseNumber: z.string().openapi({
        description: "The company's registration number in its national business register, without the scheme prefix.",
        example: "1012081766",
    }),
    vatNumber: z.string().openapi({
        description: "The company's VAT number, including its country prefix.",
        example: "BE1012081766",
    }),
    email: z.string().nullable().openapi({
        description: "Contact email address recorded for the company. This is not where document notifications go; those are configured per address through the notification email address endpoints.",
        example: "billing@example.com",
    }),
    phone: z.string().nullable().openapi({
        description: "Contact phone number recorded for the company.",
        example: "+32 9 396 20 39",
    }),
    isSmpRecipient: z.boolean().openapi({
        description: "Whether the company is registered in the SMP to receive documents. Set it to false for a company that only sends. Registration also requires the company to be verified when your team's verification requirements are strict, and never happens for playground teams.",
        example: true,
    }),
    isVerified: z.boolean().openapi({
        description: "Whether an authorised representative completed the identity check, which is needed before exchanging documents. Start the check with the verify company endpoint.",
        example: true,
    }),
    createdAt: z.string().datetime().openapi({
        description: "When the company was created.",
    }),
    updatedAt: z.string().datetime().openapi({
        description: "When the company was last changed.",
    }),
});

export function toCompanyResponse(company: Company) {
    const {
        accessPointProvider: _accessPointProvider,
        smpProvider: _smpProvider,
        ...publicCompany
    } = company;

    return publicCompany;
}
