import { z } from "zod";

export type Plan = {
  id: string;
  isAvailable: boolean;
} & BillingConfig;

export const BillingConfigSchema = z.object({
  name: z.string(),
  basePrice: z.number(),
  minimumPrice: z.number().optional(),
  includedMonthlyDocuments: z.number(),
  documentOveragePrice: z.number(),
  incomingDocumentOveragePrice: z.number().optional(),
  outgoingDocumentOveragePrice: z.number().optional(),
});

export type BillingConfig = z.infer<typeof BillingConfigSchema>;

export const allPlans: Plan[] = [
  {
    id: "developer",
    isAvailable: true,
    name: "Free",
    basePrice: 0,
    includedMonthlyDocuments: 25,
    documentOveragePrice: 0.3,
  },
  {
    id: "starter",
    isAvailable: true,
    name: "Starter",
    basePrice: 29,
    includedMonthlyDocuments: 200,
    documentOveragePrice: 0.2,
  },
  {
    id: "professional",
    isAvailable: true,
    name: "Professional 1000",
    basePrice: 99,
    includedMonthlyDocuments: 1000,
    documentOveragePrice: 0.1,
  },
  {
    id: "professional-2500",
    isAvailable: true,
    name: "Professional 2500",
    basePrice: 199,
    includedMonthlyDocuments: 2500,
    documentOveragePrice: 0.08,
  },
  {
    id: "professional-5000",
    isAvailable: true,
    name: "Professional 5000",
    basePrice: 349,
    includedMonthlyDocuments: 5000,
    documentOveragePrice: 0.07,
  },
  {
    id: "enterprise",
    isAvailable: false,
    name: "Enterprise",
    basePrice: 0,
    minimumPrice: 0,
    includedMonthlyDocuments: 0,
    documentOveragePrice: 0.05,
  }
]

export const availablePlans = allPlans.filter((plan) => plan.isAvailable);