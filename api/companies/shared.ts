import z from "zod";
import type { Company } from "@peppol/data/companies";

export const companyResponse = z.object({
    id: z.string(),
    teamId: z.string(),
    name: z.string(),
    address: z.string(),
    postalCode: z.string(),
    city: z.string(),
    country: z.string(),
    enterpriseNumberScheme: z.string().nullable(),
    enterpriseNumber: z.string(),
    vatNumber: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    isSmpRecipient: z.boolean(),
    isVerified: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});

export function toCompanyResponse(company: Company) {
    const {
        accessPointProvider: _accessPointProvider,
        smpProvider: _smpProvider,
        ...publicCompany
    } = company;

    return publicCompany;
}
