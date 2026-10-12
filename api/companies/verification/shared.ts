import { z } from "zod";
import "zod-openapi/extend";

export const verificationOutcomeSchema = z.enum(["verified", "rejected"]).openapi({
    description: "How a company verification ended: `verified` or `rejected`.",
    ref: "VerificationOutcome",
});
